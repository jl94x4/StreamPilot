import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Film, Music, Search, Tv } from 'lucide-react';
import {
    DiscoverGridSizeSelect,
    PlayerHomeHeroSkeleton,
    PlayerHomeSkeleton,
    PlayerTvHomeStageSkeleton,
    DiscoverSectionHeader,
    discoveryTheme,
    useDiscoverGridSize,
    useDiscoverI18n,
    homeRailPosterDensity,
    upgraderLandscapeGridStyle,
    upgraderPosterGridClass,
    upgraderPosterGridStyle,
} from './host';
import { beginHomeRowPriority, endHomeRowPriority, fetchMediaPlayerHome, fetchMediaPlayerHomeFull, fetchMediaPlayerHomeHero, fetchMediaPlayerHomeHeroRefresh, fetchMediaPlayerItem, fetchMediaPlayerLibrary, fetchMediaPlayerWatchlist, fetchPopularSearches, prefetchMediaPlayerItem, recordPopularSearch, searchMediaPlayer, setMediaPlayerWatched } from './api';
import { isPlexDirectMode } from '../plex-client/config';
import {
    forgetHomePosterFocus,
    peekRememberedTvFocusKey,
    pinTvRailItemToSlot,
    rememberTvFocusKey,
    visibleHomeStage,
} from '../plex-client/useTvRemote';
import { PLAYER_APP_BASE, PLAYER_SCROLL_ID } from './paths';
import { MediaPlayerHomeHero, type HomeHeroSlide } from './MediaPlayerHomeHero';
import { PlayerPosterCard } from './PlayerPosterCard';
import { PlayerRail, PlayerTvRowStack } from './PlayerRail';
import { viewMoreShelfFromHub, type ViewMoreShelfSource } from './PlayerViewMoreCard';
import {
    applyHomeRowOrder,
    applyLibraryNavOrder,
    applyLibraryNavOrderToHubs,
    classifyPlayerHomeHub,
    continueWatchingRailAspect,
    PLAYER_SCREENSAVER_SOURCE_LABEL_KEYS,
    PLAYER_SETTINGS_DRAFT_EVENT,
    PLAYER_SETTINGS_EVENT,
    stabilizeContinueWatchingOrder,
} from './playerSettings';
import {
    consumePlayerSearchFocus,
    consumePlayerSearchQuery,
    isHeroSlidesCacheFresh,
    isPlayerHomeCacheFresh,
    mergePlayerHomePayloads,
    PLAYER_HOME_RESET_EVENT,
    PLAYER_SEARCH_CLEAR_EVENT,
    PLAYER_SEARCH_INPUT_ID,
    PLAYER_METADATA_REFRESHED_EVENT,
    PLAYER_SEARCH_OPEN_EVENT,
    PLAYER_VOICE_RESULT_EVENT,
    readRecentSearches,
    rememberRecentSearch,
    coalescePlayerHomeWithCache,
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
import { PlayerServiceBrandMark } from './PlayerServiceBrandMark';
import { PlayerTvScreensaver } from './PlayerTvScreensaver';
import { PlayerTvSearch, PlayerTvSearchRecents } from './PlayerTvSearch';
import { itemHasBillboardBrandMeta } from './studioLogo.js';
import { applyRememberedProgress, asRecentlyAddedPlayerItem, formatPlayerDate, formatPlayerDuration, heroRowCardItem, hideWatchedPlayerItems, isMusicPlayerItem, isPlayerBackdropReady, keepContinueWatchingPoster, mapContinueWatchingItemsForLayout, pickRicherSummary, pinTvNeighborBackdrops, playerItemBackdropUrl, plexBackdropUrl, plexLogoUrl, PLAYER_PROGRESS_EVENT, prefetchContinueWatchingImages, prefetchHomeRowPosters, primeNearbyTvBillboard, replaceFamilyContinueSlot, restoreContinueSlot, stampFamilyLastViewed, warmPlayerBackdrop, watchTargetTouches, withShowPoster } from './playerUtils';
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
    viewMoreShelf?: ViewMoreShelfSource | null;
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
        // Skip the in-between posters while the remote is repeating.
        showTimerRef.current = window.setTimeout(() => show(next), 70);
    }, [show]);
    const keySoon = useCallback((key: string) => {
        window.clearTimeout(keyTimerRef.current);
        if (!key) return;
        // The focus ring moves immediately. The billboard waits until the
        // remote pauses so a fast scroll doesn't rebuild Home on every poster.
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

const HomeSpotBody: React.FC<{ item: PlayerItem }> = ({ item }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const logoKey = String(item.ratingKey || item.logo || '');
    useEffect(() => {
        setLogoFailed(false);
    }, [logoKey]);
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
        <>
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
            {/* Episode title lives in meta (SxxExx · Title); keep show tagline only when no episode line. */}
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
        </>
    );
};

/** Plex-style: on row change the old metadata fades up and out; the new block fades in after. */
const HomeSpot: React.FC<{
    item: PlayerItem | null;
    rowId?: string;
    rowDir?: 'up' | 'down' | null;
}> = ({ item, rowId = '', rowDir = null }) => {
    const [current, setCurrent] = useState<PlayerItem | null>(item);
    const [outgoing, setOutgoing] = useState<PlayerItem | null>(null);
    const [exitDir, setExitDir] = useState<'up' | 'down'>('up');
    const [enterDir, setEnterDir] = useState<'up' | 'down'>('down');
    const [entering, setEntering] = useState(false);
    const [enterEpoch, setEnterEpoch] = useState(0);
    const rowRef = useRef(rowId);
    const currentRef = useRef<PlayerItem | null>(item);
    const itemRef = useRef<PlayerItem | null>(item);
    const rowDirRef = useRef(rowDir);
    const animGenRef = useRef(0);
    const timersRef = useRef({ out: 0, enter: 0 });
    currentRef.current = current;
    itemRef.current = item;
    rowDirRef.current = rowDir;

    const clearAnimTimers = () => {
        window.clearTimeout(timersRef.current.out);
        window.clearTimeout(timersRef.current.enter);
        timersRef.current.out = 0;
        timersRef.current.enter = 0;
    };

    // Row changes own the fade. Do not depend on `item` — focus settle after a row
    // move used to re-enter this effect and fight the animation.
    useEffect(() => {
        const prevRow = rowRef.current;
        const rowChanged = Boolean(rowId && prevRow && rowId !== prevRow);
        rowRef.current = rowId;
        if (!rowChanged) return undefined;

        const prev = currentRef.current;
        const next = itemRef.current;
        const dir = rowDirRef.current === 'up' || rowDirRef.current === 'down'
            ? rowDirRef.current
            : 'down';
        if (!prev || !next) {
            clearAnimTimers();
            animGenRef.current += 1;
            setOutgoing(null);
            setEntering(false);
            setCurrent(next);
            return undefined;
        }

        const gen = animGenRef.current + 1;
        animGenRef.current = gen;
        clearAnimTimers();
        setExitDir(dir === 'down' ? 'up' : 'down');
        setEnterDir(dir === 'down' ? 'down' : 'up');
        setOutgoing(prev);
        setCurrent(next);
        setEnterEpoch(gen);
        setEntering(true);
        timersRef.current.out = window.setTimeout(() => {
            if (animGenRef.current !== gen) return;
            setOutgoing(null);
        }, 430);
        timersRef.current.enter = window.setTimeout(() => {
            if (animGenRef.current !== gen) return;
            setEntering(false);
        }, 500);
        return undefined;
    }, [rowId]);

    // Left/right (and focus settle): refresh copy in place. Never touch outgoing/entering.
    useEffect(() => {
        if (!item) {
            clearAnimTimers();
            animGenRef.current += 1;
            setCurrent(null);
            setOutgoing(null);
            setEntering(false);
            return;
        }
        setCurrent(item);
    }, [item]);

    useEffect(() => () => clearAnimTimers(), []);

    if (!current && !outgoing) return null;
    return (
        <div className="player-home-spot-stage" aria-live="polite">
            {outgoing ? (
                <div
                    className={`player-home-spot is-exit is-exit-${exitDir}`}
                    key={`out-${outgoing.ratingKey}-${exitDir}-${enterEpoch}`}
                    aria-hidden
                >
                    <HomeSpotBody item={outgoing} />
                </div>
            ) : null}
            {current ? (
                <div
                    className={`player-home-spot${entering ? ` is-enter is-enter-${enterDir}` : ''}`}
                    // Epoch bumps only on row change so L/R never remounts / restarts fade.
                    key={`in-${rowId || 'spot'}-${enterEpoch}`}
                >
                    <HomeSpotBody item={current} />
                </div>
            ) : null}
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

const recentShowIdentity = (item: PlayerItem) => {
    const raw = item.type === 'episode'
        ? item.grandparentRatingKey
        : item.type === 'season'
            ? item.parentRatingKey
            : item.type === 'show'
                ? item.ratingKey
                : '';
    const id = String(raw || '').replace(/\D/g, '');
    if (id) return `id:${id}`;
    const title = String(item.showTitle || item.title || '').trim().toLowerCase();
    return title ? `title:${title}` : '';
};

/** A bulk episode add collapses to one card and used to be the whole row. */
const mergeThinRecentShows = (items: PlayerItem[], extra?: PlayerItem[]) => {
    if (!extra?.length || items.length >= 8) return items;
    const seen = new Set(items.map(recentShowIdentity).filter(Boolean));
    const out = items.slice();
    for (const show of extra) {
        if (out.length >= 24) break;
        if (show.type !== 'show') continue;
        const identity = recentShowIdentity(show);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        out.push(show);
    }
    return out;
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
    const [recentFillBySection, setRecentFillBySection] = useState<Record<string, PlayerItem[]>>({});
    const recentFillLoadedRef = useRef(new Set<string>());
    const networkOnline = usePlayerNetworkStatus();
    const [query, setQuery] = useState('');
    const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
    const [popularSearches, setPopularSearches] = useState<string[]>([]);
    const [results, setResults] = useState<PlayerItem[]>([]);
    const [searching, setSearching] = useState(false);
    const [searchActive, setSearchActive] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    useEffect(() => {
        const openSearch = () => {
            setSearchActive(true);
            window.setTimeout(() => {
                if (isTvShell) {
                    const key = document.querySelector<HTMLElement>('[data-tv-search-key="q"]');
                    key?.focus();
                    return;
                }
                searchRef.current?.focus({ preventScroll: false });
                searchRef.current?.select();
            }, 40);
        };
        const onOpen = () => openSearch();
        const onVoice = (event: Event) => {
            const query = String((event as CustomEvent<string>).detail || '').trim();
            // Handled live. Drop the copy kept for a Home that was not mounted yet.
            consumePlayerSearchQuery();
            openSearch();
            if (query) setQuery(query);
        };
        const pendingQuery = consumePlayerSearchQuery();
        if (pendingQuery) {
            consumePlayerSearchFocus();
            openSearch();
            setQuery(pendingQuery);
        } else if (consumePlayerSearchFocus()) {
            openSearch();
        }
        window.addEventListener(PLAYER_SEARCH_OPEN_EVENT, onOpen);
        window.addEventListener(PLAYER_VOICE_RESULT_EVENT, onVoice);
        return () => {
            window.removeEventListener(PLAYER_SEARCH_OPEN_EVENT, onOpen);
            window.removeEventListener(PLAYER_VOICE_RESULT_EVENT, onVoice);
        };
    }, [isTvShell]);

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

    const homeRefreshGen = useRef(0);
    const refreshHome = useCallback((opts?: { force?: boolean; quietRetry?: boolean }) => {
        const gen = ++homeRefreshGen.current;
        const current = () => gen === homeRefreshGen.current;
        const cachedHome = readPlayerHomeCache();
        const cachedHasRows = playerHomeHasRows(cachedHome);
        const cachedNeedsFull = playerHomeNeedsFull(cachedHome);
        const skipPartial = !opts?.force && cachedHasRows && !!cachedHome && isPlayerHomeCacheFresh();
        if (skipPartial && !cachedNeedsFull) {
            if (current()) {
                setHome(cachedHome);
                setLoading(false);
            }
            return Promise.resolve();
        }
        beginHomeRowPriority();
        if (!cachedHasRows) {
            if (current()) setLoading(true);
        } else if (current()) {
            setHome(cachedHome);
            setLoading(false);
        }
        const applyFull = (full: PlayerHome, base: PlayerHome | null) => {
            if (!current()) return;
            const livePins = (full.hubs || []).some((hub) => (
                !!hub.items?.length
                && !isContinueWatchingHub(hub)
                && !isBecauseYouWatchedHub(hub)
                && !/^recentlyadded\./i.test(String(hub.identifier || ''))
            ));
            // A successful pin list replaces what was on screen, including rows
            // Collexions has since removed. Merge only when this pass found no pins.
            const mergedRaw = livePins
                ? full
                : (playerHomeHasRows(full)
                    ? mergePlayerHomePayloads(full, base || full)
                    : { ...(base || full), partial: true });
            const merged = coalescePlayerHomeWithCache(mergedRaw, readPlayerHomeCache()) || mergedRaw;
            if (!playerHomeHasContentHubs(full) && !playerHomeHasContentHubs(merged)) {
                merged.partial = true;
            }
            if (playerHomeHasRows(merged)) writePlayerHomeCache(merged);
            setHome(merged);
        };
        const followFull = (base: PlayerHome | null) => (
            fetchMediaPlayerHomeFull()
                .then((full) => applyFull(full, base))
                .catch(() => undefined)
        );
        if (isTvShell || (skipPartial && cachedNeedsFull)) {
            // Paint includeMeta pins as soon as they arrive. The full pass still
            // fills empty shells and replaces the list — it must not be the first
            // paint, or opening the app waits on every hub refill.
            setLoading(!cachedHasRows);
            const paintFast = (data: PlayerHome | null) => {
                // The fast Home answer often has one mixed Recently Added row and
                // drops pins that still need a fill. Keep the last real Home on screen.
                if (isTvShell && cachedHasRows && cachedHome && playerHomeHasContentHubs(cachedHome)) {
                    return cachedHome;
                }
                if (!current() || !data || !playerHomeHasRows(data)) return data;
                const cached = readPlayerHomeCache();
                const next = coalescePlayerHomeWithCache(data, cached) || data;
                if (playerHomeHasRows(next)) writePlayerHomeCache(next);
                setHome(next);
                setError(null);
                setLoading(false);
                return next;
            };
            return fetchMediaPlayerHome()
                .then((data) => paintFast(data) || data)
                .catch(() => cachedHasRows ? cachedHome : null)
                .then((base) => followFull(base || (cachedHasRows ? cachedHome : null)))
                .catch((err) => {
                    if (!current() || cachedHasRows) return;
                    setError(String(err?.message || t('mediaPlayerPage.loadError')));
                })
                .finally(() => {
                    if (current()) setLoading(false);
                    endHomeRowPriority();
                });
        }
        return fetchMediaPlayerHome()
            .then((data) => {
                if (!current()) return undefined;
                const cached = readPlayerHomeCache();
                const next = coalescePlayerHomeWithCache(data, cached) || data;
                if (next && playerHomeHasRows(next)) writePlayerHomeCache(next);
                setHome(next);
                setError(null);
                setLoading(false);
                if (!playerHomeNeedsFull(next) && !data?.partial) return undefined;
                return followFull(next);
            })
            .catch((err) => {
                if (!current()) return;
                const cached = readPlayerHomeCache();
                if (playerHomeHasRows(cached)) {
                    // Keep showing the last good Home. Never flash "saved library" for a
                    // transient PMS blip — Android TV hits this constantly while LAN is fine.
                    setHome(cached);
                    if (!opts?.quietRetry) {
                        window.setTimeout(() => {
                            void refreshHome({ quietRetry: true });
                        }, 2000);
                    }
                } else {
                    setError(String(err?.message || t('mediaPlayerPage.loadError')));
                }
            })
            .finally(() => {
                if (current()) setLoading(false);
                endHomeRowPriority();
            });
    }, [isTvShell, t]);

    // Coming back online (or a flaky Android offline→online flip) should refetch quietly.
    useEffect(() => {
        if (!active || !isTvShell || networkOnline) return undefined;
        const onOnline = () => {
            void refreshHome({ force: true });
        };
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [active, isTvShell, networkOnline, refreshHome]);

    useEffect(() => {
        if (!active) return undefined;
        const onMetadataRefreshed = (event: Event) => {
            const detail = (event as CustomEvent<{ ratingKey?: string; item?: PlayerItem }>).detail;
            const key = String(detail?.ratingKey || '').trim();
            const next = detail?.item;
            if (!key || !next) {
                void refreshHome({ force: true });
                return;
            }
            const touches = (row: PlayerItem) => (
                String(row.ratingKey || '') === key
                || String(row.grandparentRatingKey || '') === key
                || String(row.parentRatingKey || '') === key
            );
            const mergeRow = (row: PlayerItem): PlayerItem => {
                if (!touches(row)) return row;
                // Keep CW episode identity; swap poster/art/logo from refreshed metadata.
                if (row.type === 'episode' && next.type !== 'episode') {
                    return {
                        ...row,
                        thumb: next.thumb || row.thumb,
                        art: next.art || row.art,
                        logo: next.logo || row.logo,
                        showTitle: next.title || row.showTitle,
                    };
                }
                return { ...row, ...next, ratingKey: row.ratingKey, type: row.type };
            };
            setHome((prev) => {
                if (!prev) return prev;
                const hubs = (prev.hubs || []).map((hub) => ({
                    ...hub,
                    items: (hub.items || []).map(mergeRow),
                }));
                const patched = {
                    ...prev,
                    continueWatching: (prev.continueWatching || []).map(mergeRow),
                    hubs,
                    recentByLibrary: (prev.recentByLibrary || []).map((rail) => ({
                        ...rail,
                        items: (rail.items || []).map(mergeRow),
                    })),
                };
                writePlayerHomeCache(patched);
                return patched;
            });
            setWatchlistItems((prev) => prev.map(mergeRow));
            // Soft full reload so any other rows pick up new stamps from Plex.
            void refreshHome({ force: true });
        };
        window.addEventListener(PLAYER_METADATA_REFRESHED_EVENT, onMetadataRefreshed);
        return () => window.removeEventListener(PLAYER_METADATA_REFRESHED_EVENT, onMetadataRefreshed);
    }, [active, refreshHome]);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;
        void refreshHome({ force: true }).then(() => {
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

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 2 || searching || !results.length) return undefined;
        const timer = window.setTimeout(() => {
            setRecentSearches(rememberRecentSearch(trimmed));
            void recordPopularSearch(trimmed)
                .then((data) => setPopularSearches(Array.isArray(data?.queries) ? data.queries : []))
                .catch(() => {});
        }, 900);
        return () => window.clearTimeout(timer);
    }, [query, results, searching]);

    useEffect(() => {
        if (!isTvShell || !searchActive) return undefined;
        let cancelled = false;
        void fetchPopularSearches()
            .then((data) => {
                if (!cancelled) setPopularSearches(Array.isArray(data?.queries) ? data.queries : []);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [isTvShell, searchActive]);

    useEffect(() => {
        const onClear = () => setQuery('');
        window.addEventListener(PLAYER_SEARCH_CLEAR_EVENT, onClear);
        return () => window.removeEventListener(PLAYER_SEARCH_CLEAR_EVENT, onClear);
    }, []);

    const orderedLibraries = useMemo(
        () => applyLibraryNavOrder(home?.libraries || [], libraryNavOrder),
        [home?.libraries, libraryNavOrder],
    );

    const mapRecentItem = useCallback(
        (item: PlayerItem) => asRecentlyAddedPlayerItem(item, {
            preferSeasonPoster: settings.recentlyAddedSeasonPoster,
        }),
        [settings.recentlyAddedSeasonPoster],
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
                        : (row?.items || [])).map(mapRecentItem),
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
        return typeOrder.map((type) => {
            const library = orderedLibraries.find((row) => {
                const libraryType = row.type === 'show' ? 'show' : row.type === 'artist' ? 'artist' : 'movie';
                return libraryType === type;
            });
            return {
                id: `recent:${type}`,
                title: titles[type],
                items: (settings.hideWatchedFromRecents
                    ? hideWatchedPlayerItems(dedupeItems(buckets[type]))
                    : dedupeItems(buckets[type])).map(mapRecentItem),
                // Hub page pages recentlyAdded for months of titles (home rail stays short).
                hubKey: library ? `/library/sections/${library.key}/recentlyAdded` : undefined,
                identifier: 'recentlyAdded',
            };
        }).filter((row) => row.items.length);
    }, [home, mapRecentItem, orderedLibraries, settings.hideWatchedFromRecents, settings.mixLibraries, t]);

    const hideContinueWatchingRail = !isTvShell && heroEffectiveMode === 'continue_watching';
    const showContinueWatchingRail = settings.showContinueWatching && !hideContinueWatchingRail;
    const showWatchlistRail = settings.showWatchlist;
    // TV used to force "title" (episode stills). That ignored show/season poster
    // updates in Plex and looked wrong next to Plex's own Continue Watching.
    const continueWatchingLayout = settings.continueWatchingLayout;
    const continueWatchingAspect = continueWatchingRailAspect(continueWatchingLayout);
    // Warm CW show posters + episode stills/backdrops so opening an item does not wait on art.
    useEffect(() => {
        if (!active || !home || !showContinueWatchingRail) return undefined;
        const cwHub = (home.hubs || []).find(isContinueWatchingHub);
        const items = (cwHub?.items?.length ? cwHub.items : home.continueWatching) || [];
        if (!items.length) return undefined;
        const timer = window.setTimeout(() => prefetchContinueWatchingImages(items, 24), 0);
        return () => window.clearTimeout(timer);
    }, [active, home, showContinueWatchingRail]);
    const cwOrderKeysRef = useRef<string[]>([]);
    const cwOrderSortRef = useRef(settings.continueWatchingSort);
    const freezeContinueWatching = useCallback((items: PlayerItem[]) => {
        if (cwOrderSortRef.current !== settings.continueWatchingSort) {
            cwOrderKeysRef.current = [];
            cwOrderSortRef.current = settings.continueWatchingSort;
        }
        const next = stabilizeContinueWatchingOrder(
            items.map(stampFamilyLastViewed),
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
            // TV Home shows every pinned row, including playlist pins.
            if (directHome) return true;
            if (isPlaylistHub(hub)) return false;
            if (!showContinueWatchingRail && isContinueWatchingHub(hub)) return false;
            if (!settings.showBecauseYouWatched && isBecauseYouWatchedHub(hub)) return false;
            return true;
        }).map((hub) => (
            /recent/i.test(`${hub.identifier || ''} ${hub.title || ''}`)
                ? { ...hub, items: hub.items.map(mapRecentItem) }
                : hub
        ));
        // Always regroup by Library order (incl. plex-direct / TV). Pins stay; only stack order changes.
        return applyLibraryNavOrderToHubs(filtered, orderedLibraries, libraryNavOrder);
    }, [home, libraryNavOrder, mapRecentItem, orderedLibraries, showContinueWatchingRail, settings.showBecauseYouWatched]);

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

    const thinRecentShowKeys = useMemo(() => {
        if (!isTvShell || settings.mixLibraries || !home) return [] as Array<{ sectionId: string; libraryKey: string }>;
        const showLibrary = (library?: { type?: string; title?: string }) => {
            const type = String(library?.type || '').toLowerCase();
            if (type === 'show' || type === 'tv') return true;
            return /\btv\b|show/i.test(String(library?.title || ''));
        };
        const libraryForBare = (sectionId: string) => orderedLibraries.find((library) => {
            const bare = String(library.key || '').split('::').pop();
            return bare === sectionId || String(library.key) === sectionId;
        });
        const out: Array<{ sectionId: string; libraryKey: string }> = [];
        const seen = new Set<string>();
        const add = (sectionId: string, count: number) => {
            if (!sectionId || count >= 8 || seen.has(sectionId)) return;
            const library = libraryForBare(sectionId);
            if (!library || !showLibrary(library)) return;
            seen.add(sectionId);
            out.push({ sectionId, libraryKey: String(library.key) });
        };
        for (const hub of plexHubs) {
            if (!isRecentHub(hub)) continue;
            const groups = new Map<string, number>();
            let grouped = true;
            for (const item of hub.items || []) {
                const id = String(item.librarySectionID || '').trim();
                if (!id) {
                    grouped = false;
                    break;
                }
                groups.set(id, (groups.get(id) || 0) + 1);
            }
            if (grouped && groups.size) {
                for (const [id, count] of groups) add(id, count);
                continue;
            }
            const name = String(hub.title || '').match(/recently added\s*(?:in|·)\s+(.+)/i)?.[1]?.trim().toLowerCase();
            if (!name || (hub.items?.length || 0) >= 8) continue;
            const library = orderedLibraries.find((row) => row.title.trim().toLowerCase() === name);
            if (!library || !showLibrary(library)) continue;
            add(String(library.key || '').split('::').pop() || '', hub.items?.length || 0);
        }
        return out;
    }, [home, isTvShell, orderedLibraries, plexHubs, settings.mixLibraries]);

    useEffect(() => {
        if (!active || !thinRecentShowKeys.length) return undefined;
        const pending = thinRecentShowKeys.filter((row) => !recentFillLoadedRef.current.has(row.sectionId));
        if (!pending.length) return undefined;
        pending.forEach((row) => recentFillLoadedRef.current.add(row.sectionId));
        let cancelled = false;
        void Promise.all(pending.map(async (row) => {
            const load = (sort: string) => fetchMediaPlayerLibrary(row.libraryKey, 0, 40, { sort }).catch(() => null);
            const page = (await load('updatedAt:desc')) || (await load('addedAt:desc'));
            const items = Array.isArray(page?.items) ? page.items : [];
            if (!items.length) recentFillLoadedRef.current.delete(row.sectionId);
            return { sectionId: row.sectionId, items };
        })).then((rows) => {
            if (cancelled) {
                rows.forEach((row) => recentFillLoadedRef.current.delete(row.sectionId));
                return;
            }
            setRecentFillBySection((prev) => {
                const next = { ...prev };
                let changed = false;
                for (const row of rows) {
                    if (!row.items.length || next[row.sectionId]?.length) continue;
                    next[row.sectionId] = row.items;
                    changed = true;
                }
                return changed ? next : prev;
            });
        });
        return () => { cancelled = true; };
    }, [active, thinRecentShowKeys]);

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
                viewMoreShelf: viewMoreShelfFromHub(cwHub || {
                    identifier: 'home.continueWatching',
                    hubKey: '/library/onDeck',
                    items: cwItems,
                    title: t('mediaPlayerPage.continueWatching'),
                }),
            });
        }
        if (showWatchlistRail && watchlistItems.length) {
            rows.push({
                id: 'home.watchlist',
                title: t('mediaPlayerPage.navWatchlist'),
                items: watchlistItems,
                aspect: '2/3',
                onViewAll: onOpenWatchlist,
                viewMoreShelf: { watchlist: true },
            });
        }
        const becauseHubs = plexHubs.filter(isBecauseYouWatchedHub);
        const others = plexHubs.filter((hub) => !isContinueWatchingHub(hub) && !isBecauseYouWatchedHub(hub));
        const libraryForSection = (sectionId: string) => orderedLibraries.find((library) => {
            const bare = String(library.key || '').split('::').pop();
            return bare === sectionId || String(library.key) === sectionId;
        });
        for (const hub of others) {
            const hero = Boolean(hub.heroRow);
            const recentItems = isRecentHub(hub) && !settings.mixLibraries
                ? hub.items
                : null;
            const recentGroups = new Map<string, PlayerItem[]>();
            if (recentItems) {
                for (const item of recentItems) {
                    const sectionId = String(item.librarySectionID || '').trim();
                    if (!sectionId) {
                        recentGroups.clear();
                        break;
                    }
                    const list = recentGroups.get(sectionId) || [];
                    list.push(item);
                    recentGroups.set(sectionId, list);
                }
            }
            if (recentGroups.size > 1) {
                const order = orderedLibraries
                    .map((library) => String(library.key || '').split('::').pop() || '')
                    .filter((id) => recentGroups.has(id));
                for (const sectionId of recentGroups.keys()) {
                    if (!order.includes(sectionId)) order.push(sectionId);
                }
                for (const sectionId of order) {
                    const library = libraryForSection(sectionId);
                    const base = settings.hideWatchedFromRecents
                        ? hideWatchedPlayerItems(recentGroups.get(sectionId) || [])
                        : (recentGroups.get(sectionId) || []);
                    const extra = settings.hideWatchedFromRecents
                        ? hideWatchedPlayerItems(recentFillBySection[sectionId])
                        : recentFillBySection[sectionId];
                    const items = mergeThinRecentShows(base, extra).map(mapRecentItem);
                    if (!items.length) continue;
                    const title = library
                        ? t('mediaPlayerPage.recentlyAddedIn', { name: library.title })
                        : hub.title;
                    rows.push({
                        id: `recent:${sectionId}`,
                        title,
                        items,
                        aspect: library?.type === 'artist' ? 'square' : '2/3',
                        onViewAll: library && onOpenHub ? () => onOpenHub({
                            title,
                            identifier: 'recentlyAdded',
                            items,
                            hubKey: `/library/sections/${library.key}/recentlyAdded`,
                        }) : undefined,
                        viewMoreShelf: library
                            ? { path: `/library/sections/${library.key}/recentlyAdded`, identifier: 'recentlyAdded' }
                            : viewMoreShelfFromHub(hub),
                    });
                }
                continue;
            }
            const recentSectionId = recentGroups.size === 1
                ? ([...recentGroups.keys()][0] || '')
                : '';
            const titledLibrary = !recentSectionId && isRecentHub(hub)
                ? orderedLibraries.find((row) => row.title.trim().toLowerCase() === String(hub.title || '').match(/recently added\s*(?:in|·)\s+(.+)/i)?.[1]?.trim().toLowerCase())
                : undefined;
            const fillSectionId = recentSectionId || (titledLibrary ? (String(titledLibrary.key || '').split('::').pop() || '') : '');
            const recentBase = isRecentHub(hub)
                ? (settings.hideWatchedFromRecents ? hideWatchedPlayerItems(hub.items) : hub.items)
                : hub.items;
            const recentExtra = fillSectionId
                ? (settings.hideWatchedFromRecents
                    ? hideWatchedPlayerItems(recentFillBySection[fillSectionId])
                    : recentFillBySection[fillSectionId])
                : undefined;
            rows.push({
                id: hub.identifier || `hub:${hub.title}`,
                title: hub.title,
                items: hero
                    ? hub.items.map(heroRowCardItem)
                    : (isRecentHub(hub)
                        ? mergeThinRecentShows(recentBase, recentExtra).map(mapRecentItem)
                        : hub.items),
                aspect: hero
                    ? '16/9'
                    : (classifyPlayerHomeHub(hub) === 'artist' || hub.items.every((row) => isMusicPlayerItem(row))
                        ? 'square'
                        : '2/3'),
                onViewAll: (hub.hubKey || hub.collectionRatingKey || hub.playlistRatingKey) && onOpenHub
                    ? () => onOpenHub(hub)
                    : undefined,
                viewMoreShelf: viewMoreShelfFromHub(hub),
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
                    viewMoreShelf: row.hubKey
                        ? { path: row.hubKey, identifier: row.identifier || 'recentlyAdded' }
                        : null,
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
                    viewMoreShelf: viewMoreShelfFromHub(hub),
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
        mapRecentItem,
        orderedLibraries,
        plexHubs,
        recentRails,
        settings.mixLibraries,
        recentFillBySection,
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
        return plexBackdropUrl(
            (first as { backdropArt?: string | null } | undefined)?.backdropArt || first?.art || first?.thumb,
        ) || '';
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
        episodes.sort((a, b) => {
            const showA = String(a.showTitle || '').toLowerCase();
            const showB = String(b.showTitle || '').toLowerCase();
            if (showA !== showB) return showA < showB ? -1 : 1;
            const seasonA = Number(a.parentIndex);
            const seasonB = Number(b.parentIndex);
            const seasonRank = (value: number) => (Number.isFinite(value) && value > 0 ? value : 9999);
            if (seasonRank(seasonA) !== seasonRank(seasonB)) return seasonRank(seasonA) - seasonRank(seasonB);
            const episodeA = Number(a.index);
            const episodeB = Number(b.index);
            const episodeRank = (value: number) => (Number.isFinite(value) && value > 0 ? value : 9999);
            if (episodeRank(episodeA) !== episodeRank(episodeB)) return episodeRank(episodeA) - episodeRank(episodeB);
            const titleA = String(a.episodeTitle || a.title || '').toLowerCase();
            const titleB = String(b.episodeTitle || b.title || '').toLowerCase();
            if (titleA !== titleB) return titleA < titleB ? -1 : 1;
            return 0;
        });
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
    const [tvRowDir, setTvRowDir] = useState<'up' | 'down' | null>(null);
    const [tvFocusKey, setTvFocusKey] = useState('');
    const [tvSpotExtra, setTvSpotExtra] = useState<Record<string, PlayerItem>>({});
    const tvRowIndexRef = useRef(0);
    const tvRowsRef = useRef(tvHomeRows);
    const tvRowFocusRef = useRef<Record<string, string>>({});
    /** Sidebar Home starts on the first poster. Back from a title keeps the open card. */
    const landOnFirstRef = useRef(true);
    tvRowIndexRef.current = tvRowIndex;
    tvRowsRef.current = tvHomeRows;

    const clearHomeRowHighlights = () => {
        const ids = tvRowsRef.current.map((row) => row.id);
        tvRowFocusRef.current = {};
        forgetHomePosterFocus(ids);
        landOnFirstRef.current = true;
    };

    useEffect(() => {
        const onHomeReset = () => {
            setQuery('');
            setResults([]);
            setSearching(false);
            setSearchActive(false);
            searchRef.current?.blur();
            // Sidebar Home (or Back-to-home) while already on Home → first poster of the first row.
            clearHomeRowHighlights();
            landOnFirstRef.current = false;
            setTvRowDir(null);
            setTvRowIndex(0);
            setTvFocusKey('');
            const firstRow = tvRowsRef.current[0];
            const firstKey = String(firstRow?.items?.[0]?.ratingKey || '').trim();
            if (firstRow?.id && firstKey) {
                setTvFocusKey(firstKey);
                rememberTvFocusKey(firstKey, PLAYER_APP_BASE);
            }
            const scroller = document.getElementById(PLAYER_SCROLL_ID);
            if (scroller) {
                try {
                    scroller.scrollTo({ top: 0, behavior: 'auto' });
                } catch {
                    scroller.scrollTop = 0;
                }
            }
            let attempts = 0;
            const focusTop = () => {
                const stage = visibleHomeStage();
                const rail = stage?.querySelector<HTMLElement>('.player-home-stage-rail');
                const match = firstKey && rail
                    ? rail.querySelector<HTMLElement>(`[data-tv-poster-btn="1"][data-tv-key="${CSS.escape(firstKey)}"]`)
                    : null;
                const btn = match || rail?.querySelector<HTMLElement>('[data-tv-poster-btn="1"]');
                if (btn) {
                    try {
                        btn.focus({ preventScroll: true });
                    } catch {
                        btn.focus();
                    }
                    pinTvRailItemToSlot(btn);
                    return;
                }
                if (attempts++ < 24) window.setTimeout(focusTop, 16);
            };
            window.requestAnimationFrame(focusTop);
            window.setTimeout(focusTop, 40);
        };
        window.addEventListener(PLAYER_HOME_RESET_EVENT, onHomeReset);
        return () => window.removeEventListener(PLAYER_HOME_RESET_EVENT, onHomeReset);
    }, []);

    const tvStage = isTvShell && !searchActive;
    const tvRowSafeIndex = Math.min(tvRowIndex, Math.max(0, tvHomeRows.length - 1));
    const tvActiveRow = tvHomeRows[tvRowSafeIndex] || null;
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
            thumb: base.thumb || extra.thumb,
            // Keep the art already on the card. A later metadata fetch used to swap in a
            // different URL and the backdrop sat on the previous title until it downloaded.
            art: base.art || extra.art,
            logo: extra.logo || base.logo,
            // Recently Added cards use the show title on the poster; keep that for the
            // billboard headline and pull SxxExx / episode name / synopsis from the leaf.
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
    const tvStageStillSeed = plexBackdropUrl(
        (tvSpotItem as { backdropArt?: string | null } | null)?.backdropArt || tvSpotItem?.art || tvSpotItem?.thumb || '',
    ) || tvFocusStillSeed;

    useEffect(() => {
        if (!tvStage || !active) return;
        const prev = tvHomeRows[tvRowSafeIndex - 1];
        const next = tvHomeRows[tvRowSafeIndex + 1];
        const neighbors = [
            playerItemBackdropUrl(next?.items?.[0]),
            playerItemBackdropUrl(next?.items?.[1]),
            playerItemBackdropUrl(prev?.items?.[0]),
            playerItemBackdropUrl(prev?.items?.[1]),
        ];
        pinTvNeighborBackdrops(neighbors);
        if (tvStageStillSeed) warmPlayerBackdrop(tvStageStillSeed, true);
        const nextFirst = playerItemBackdropUrl(next?.items?.[0]);
        if (nextFirst) warmPlayerBackdrop(nextFirst, true);
        if (tvHomeRows.length) prefetchHomeRowPosters(tvHomeRows, tvRowSafeIndex);
    }, [active, tvRowSafeIndex, tvActiveRow?.id, tvStage, tvStageStillSeed, tvHomeRows]);

    useEffect(() => {
        if (tvRowIndex >= tvHomeRows.length && tvHomeRows.length) setTvRowIndex(0);
    }, [tvHomeRows.length, tvRowIndex]);

    useEffect(() => {
        // Keep-alive Home must not steal Library Recommended row events.
        if (!tvStage || !active) return undefined;
        const onRow = (event: Event) => {
            const dir = (event as CustomEvent<{ dir?: 'up' | 'down' }>).detail?.dir;
            const rows = tvRowsRef.current;
            if (!rows.length || (dir !== 'down' && dir !== 'up')) return;
            const current = tvRowIndexRef.current;
            const next = dir === 'down'
                ? Math.min(rows.length - 1, current + 1)
                : Math.max(0, current - 1);
            const prev = rows[current];
            if (prev && tvFocusKey && !landOnFirstRef.current) {
                tvRowFocusRef.current[prev.id] = tvFocusKey;
            }
            landOnFirstRef.current = false;
            if (next !== current) {
                setTvRowDir(dir);
                setTvRowIndex(next);
            }
        };
        window.addEventListener(TV_HOME_ROW_EVENT, onRow);
        return () => window.removeEventListener(TV_HOME_ROW_EVENT, onRow);
    }, [active, tvFocusKey, tvStage]);

    // Keep per-row restore in sync with live poster focus while this Home visit lasts.
    // Sidebar Home sets landOnFirstRef so that visit starts on the first poster.
    useEffect(() => {
        if (landOnFirstRef.current) return;
        if (!tvStage || !active || !tvActiveRow?.id || !tvFocusKey) return;
        tvRowFocusRef.current[tvActiveRow.id] = tvFocusKey;
    }, [active, tvActiveRow?.id, tvFocusKey, tvStage]);

    useLayoutEffect(() => {
        if (!tvStage || !active || !tvActiveRow) return undefined;
        const rowId = tvActiveRow.id;
        const landOnFirst = landOnFirstRef.current;
        if (landOnFirst && tvRowIndexRef.current !== 0) return undefined;
        const rowHas = (key: string) => Boolean(key) && tvActiveRow.items.some((item) => String(item.ratingKey || '') === key);
        const remembered = landOnFirst ? '' : peekRememberedTvFocusKey();
        const saved = (rowHas(remembered) ? remembered : '')
            || (rowHas(tvRowFocusRef.current[rowId] || '') ? tvRowFocusRef.current[rowId] : '')
            || (rowHas(tvFocusKey) ? tvFocusKey : '');
        let cancelled = false;
        let attempts = 0;
        const focusEl = (btn: HTMLElement) => {
            try {
                btn.focus({ preventScroll: true });
            } catch {
                btn.focus();
            }
            pinTvRailItemToSlot(btn);
            const activeEl = document.activeElement as HTMLElement | null;
            return Boolean(activeEl && (activeEl === btn || btn.contains(activeEl)));
        };
        const focusSaved = () => {
            if (cancelled) return true;
            const stage = visibleHomeStage();
            if (!stage) return false;
            const root = stage.querySelector<HTMLElement>('.player-home-stage-rail');
            if (!root) return false;
            const posters = Array.from(root.querySelectorAll<HTMLElement>('[data-tv-poster-btn="1"]'))
                .filter((el) => !el.closest('[inert]'));
            if (!posters.length) return false;
            const rowMatch = saved
                ? posters.find((el) => el.getAttribute('data-tv-key') === saved) || null
                : null;
            const btn = rowMatch || posters[0];
            const focused = focusEl(btn);
            if (focused && landOnFirst) {
                const key = String(btn.getAttribute('data-tv-key') || '').trim();
                landOnFirstRef.current = false;
                if (key) {
                    setTvFocusKey(key);
                    rememberTvFocusKey(key, PLAYER_APP_BASE);
                }
            } else if (focused && saved && saved !== tvFocusKey) {
                setTvFocusKey(saved);
            }
            return focused;
        };
        const tick = () => {
            if (focusSaved()) return;
            if (cancelled || attempts++ >= 48) return;
            window.setTimeout(tick, 16);
        };
        // Position the poster before Chromium paints the rail at scrollLeft=0.
        if (focusSaved()) {
            return () => { cancelled = true; };
        }
        const timer = window.setTimeout(tick, 0);
        window.requestAnimationFrame(tick);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [active, tvActiveRow?.id, tvStage]);

    useEffect(() => {
        const key = String(tvSpotItem?.ratingKey || '');
        if (!tvStage || !key) return undefined;
        const serverId = tvSpotItem?.serverId || null;
        const cached = readPlayerItemCache(key);
        if (cached?.item) {
            setTvSpotExtra((prev) => (prev[key] ? prev : { ...prev, [key]: cached.item }));
            // Episodes need show studio / showTmdbId — leaf episode TMDB ids must not skip enrich.
            if (cached.item.logo && itemHasBillboardBrandMeta(cached.item) && cached.item.summary) return undefined;
        }
        let cancelled = false;
        // Wait until the remote settles so a fast scroll does not pile metadata requests.
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            prefetchMediaPlayerItem(key);
            void fetchMediaPlayerItem(key, { core: true, serverId })
                .then((page) => {
                    if (cancelled || !page?.item) return;
                    setTvSpotExtra((prev) => ({ ...prev, [key]: page.item }));
                })
                .catch(() => undefined);
        }, 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
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
                        const previous = list.find((row) => (
                            watchTargetTouches(row, key)
                            || watchTargetTouches(row, familyKey)
                            || String(row.ratingKey) === String(seed.ratingKey)
                        ));
                        const card = keepContinueWatchingPoster(seed, previous);
                        const without = nextList.filter((row) => (
                            !watchTargetTouches(row, key)
                            && !watchTargetTouches(row, familyKey)
                            && String(row.ratingKey) !== String(seed.ratingKey)
                        ));
                        nextList = [card, ...without].slice(0, 20);
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
        return <PlayerTvHomeStageSkeleton />;
    }

    if (isTvShell && error && !home) {
        return (
            <PlayerTvStatusPanel
                title={error}
                onRetry={() => { setError(null); void refreshHome({ force: true }); }}
            />
        );
    }

    const searchResultsNode = query.trim().length >= 2 ? (
        <div
            className="flex flex-col gap-6"
            data-tv-search-results={isTvShell ? '1' : undefined}
        >
            {searching && !results.length ? (
                <DiscoverSectionHeader title={t('common.searching')} />
            ) : null}
            {isTvShell ? searchGroups.map((group) => (
                group.id === 'episode' ? (
                    <section
                        key={group.id}
                        data-tv-row="1"
                        data-tv-row-id={`search:${group.id}`}
                        className="flex min-w-0 max-w-full flex-col gap-2"
                    >
                        <DiscoverSectionHeader title={group.title} />
                        <div
                            data-tv-poster-grid="1"
                            className={`${upgraderPosterGridClass(homePosterDensity)} px-3`}
                            style={{
                                ...upgraderLandscapeGridStyle(homePosterDensity),
                                columnGap: '1.5rem',
                                rowGap: '2.25rem',
                            }}
                        >
                            {group.items.map((item) => (
                                <PlayerPosterCard
                                    key={item.ratingKey}
                                    item={item}
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
                ) : (
                    <PlayerRail
                        key={group.id}
                        title={group.title}
                        rowId={`search:${group.id}`}
                        items={group.items}
                        density={homePosterDensity}
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
                )
            )) : searchGroups.map((group) => (
                <section
                    key={group.id}
                    className="flex flex-col gap-3"
                >
                    <DiscoverSectionHeader title={group.title} />
                    <div
                        className={upgraderPosterGridClass(gridSize)}
                        style={group.aspect === '16/9' ? upgraderLandscapeGridStyle(gridSize) : upgraderPosterGridStyle(gridSize)}
                    >
                        {group.items.map((item) => (
                            <PlayerPosterCard
                                key={item.ratingKey}
                                item={item}
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
    ) : null;

    return (
        <div className={isTvShell
            ? 'tv-poster-rows player-home-page player-home-stage'
            : 'tv-poster-rows player-home-page flex flex-col gap-6 pb-8'
        }>
            <HomeFocusStill
                enabled={tvStage && active && !searchActive}
                seed={tvStage ? tvStageStillSeed : ''}
                onFocusKey={tvStage ? setTvFocusKey : undefined}
            />
            {tvStage && !searchActive ? (
                <div className="player-home-stage-copy">
                    <HomeSpot
                        item={tvSpotItem}
                        rowId={tvActiveRow?.id || ''}
                        rowDir={tvRowDir}
                    />
                    {home && tvActiveRow ? (
                        <PlayerTvRowStack
                            rows={tvHomeRows.map((row) => ({
                                ...row,
                                viewAllLabel: row.onViewAll ? t('common.viewMore') : undefined,
                            }))}
                            activeIndex={tvRowSafeIndex}
                            density={homePosterDensity}
                            restoreFocusById={tvRowFocusRef.current}
                            onOpenItem={onOpenItem}
                            onPlay={onPlay}
                            onToggleWatched={toggleWatched}
                            {...railMenuProps}
                        />
                    ) : null}
                </div>
            ) : null}
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

            {isTvShell && searchActive ? (
                <div data-tv-search="1">
                    <PlayerTvSearch
                        query={query}
                        onChange={setQuery}
                    />
                    <div data-tv-search-body="1" className="player-tv-search-body">
                        <PlayerTvSearchRecents
                            query={query}
                            recent={recentSearches}
                            popular={popularSearches}
                            onPickRecent={(value) => {
                                setQuery(value);
                                window.setTimeout(() => {
                                    document.querySelector<HTMLElement>('[data-tv-search-key="q"]')?.focus();
                                }, 40);
                            }}
                        />
                        {query.trim().length >= 2 ? searchResultsNode : (
                            home ? (
                                <div className="player-home-rows flex min-w-0 flex-col gap-6">
                                    {homeSections}
                                </div>
                            ) : null
                        )}
                    </div>
                </div>
            ) : searchActive ? (
            <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                    id={PLAYER_SEARCH_INPUT_ID}
                    ref={searchRef}
                    value={query}
                    inputMode="search"
                    enterKeyHint="search"
                    aria-label={t('mediaPlayerPage.searchPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('mediaPlayerPage.searchPlaceholder')}
                    className={discoveryTheme.searchInput}
                />
            </div>
            ) : null}

            {isTvShell && searchActive ? null : searchResultsNode}

            {!isTvShell && error ? (
                <div className={discoveryTheme.emptyState}>
                    <p className={discoveryTheme.emptyTitle}>{error}</p>
                </div>
            ) : null}

            {!searchActive && !query.trim() && home && tvStage && longPressHint ? (
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

            {!searchActive && !query.trim() && home && !tvStage ? (
                <div className="player-home-rows flex min-w-0 flex-col gap-6 max-md:gap-3">
                    {homeSections}
                </div>
            ) : null}

            {!searchActive && !query.trim() && !error && !hasRails && !home?.partial ? (
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

            {isTvShell && home ? (
                <PlayerTvScreensaver
                    enabled={Boolean(active && !query.trim())}
                    continueWatchingItems={
                        tvHomeRows.find((row) => /continue|ondeck/i.test(row.id))?.items
                        || home.continueWatching
                        || []
                    }
                    recommendedItems={
                        plexHubs
                            .filter(isBecauseYouWatchedHub)
                            .flatMap((hub) => hub.items || [])
                    }
                    source={settings.screensaverSource}
                    sourceLabel={t(PLAYER_SCREENSAVER_SOURCE_LABEL_KEYS[settings.screensaverSource])}
                    shiftClock={settings.screensaverShiftClock}
                />
            ) : null}
        </div>
    );
});
