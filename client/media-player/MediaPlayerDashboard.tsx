import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    pushToast as appendToast,
    stripBasePath,
    ToastContainer,
    useDiscoverI18n,
    type ToastMessage,
} from './host';
import { fetchMediaPlayerItemMore, fetchMediaPlayerLibraries, fetchMediaPlayerMe, fetchMediaPlayerPlayFromQueue, fetchMediaPlayerShuffleQueue, startMediaPlayerPlayback } from './api';
import { MediaPlayerHome } from './MediaPlayerHome';
import { MediaPlayerWatchlist } from './MediaPlayerWatchlist';
import { MediaPlayerPlaylists } from './MediaPlayerPlaylists';
import { MediaPlayerLibrary } from './MediaPlayerLibrary';
import { MediaPlayerCollection } from './MediaPlayerCollection';
import { MediaPlayerHub } from './MediaPlayerHub';
import { MediaPlayerPlaylist } from './MediaPlayerPlaylist';
import { MediaPlayerDetails } from './MediaPlayerDetails';
import { MediaPlayerPerson } from './MediaPlayerPerson';
import { MediaPlayerStudio } from './MediaPlayerStudio';
import { MediaPlayerSettings } from './MediaPlayerSettings';
import { MediaPlayerVideo } from './MediaPlayerVideo';
import { MediaPlayerNav } from './MediaPlayerNav';
import { captureTvFocusSnapshot, rememberTvFocusKey, restoreTvFocusWhenReady } from '../plex-client/useTvRemote';
import { isAndroidTvUi } from '../plex-client/config';
import { PLAYER_APP_BASE, PLAYER_NAVIGATE_EVENT, PLAYER_SCROLL_ID, PLAYER_TV_NAV_EVENT } from './paths';
import { usePlayerSettings } from './usePlayerSettings';
import { PlayerResumeDialog } from './PlayerResumeDialog';
import { PlayerStillWatchingDialog } from './PlayerStillWatchingDialog';
import { isPlayerTrailer, resolveStartPlaybackQualityId, shouldOfferResume, sliceQueueToNextUnwatched } from './playerUtils';
import {
    consumePlayerSearchFocus,
    focusPlayerSearchInput,
    PLAYER_SERVERS_EVENT,
    readAvChoice,
    readMediaIndexChoice,
    rememberLastLibraryPath,
    resolveAvChoiceForTracks,
    writeMediaIndexChoice,
    readPlayerItemCache,
    readPlayerLibrariesCache,
    readPlayerNavExpanded,
    requestPlayerHomeReset,
    requestPlayerSearchFocus,
    restorePlayerHomeScrollWhenReady,
    restorePlayerLibraryScroll,
    restorePlayerLibraryScrollWhenReady,
    seedPlayerItemNav,
    stashPlayerHomeScroll,
    stashPlayerLibraryScroll,
    writePlayerNavExpanded,
    writePlayerScrollTop,
    usePlayerNetworkStatus,
} from './playerMemory';
import type { PlayerItem, PlayerLibraryHub, PlayerPlayOptions, PlayerPlaySession, PlayerSection } from './types';

type PlayerPersonRef = { id: string; name: string; thumb?: string | null };
type LibraryTab = 'home' | 'browse' | 'collections';

const formatTvClock = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
};

const PlayerTvClock: React.FC = () => {
    const [label, setLabel] = useState(() => formatTvClock(new Date()));

    useEffect(() => {
        const tick = () => setLabel(formatTvClock(new Date()));
        tick();
        const id = window.setInterval(tick, 1000);
        const onVisibility = () => {
            if (document.visibilityState !== 'hidden') tick();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, []);

    return (
        <div className="player-tv-clock" aria-hidden>
            {label}
        </div>
    );
};

type PlayerView =
    | { kind: 'home' }
    | { kind: 'library'; sectionKey: string; tab: LibraryTab }
    | { kind: 'collection'; sectionKey: string; ratingKey: string }
    | { kind: 'playlists' }
    | { kind: 'playlist'; ratingKey: string }
    | { kind: 'hub'; path: string; title: string; identifier?: string }
    | { kind: 'item'; ratingKey: string; serverId: string }
    | { kind: 'person'; actorId: string; name?: string; thumb?: string | null }
    | { kind: 'studio'; studioKey: string; name?: string; sectionKey?: string; mediaType?: 'movie' | 'show' }
    | { kind: 'watchlist' }
    | { kind: 'settings' };

type PendingResume = {
    item: PlayerItem;
    offsetMs: number;
    mediaIndex?: number;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
};

const readPlayerView = (): PlayerView => {
    const href = typeof window !== 'undefined' ? window.location : { pathname: PLAYER_APP_BASE, search: '' };
    const parts = stripBasePath(href.pathname)
        .split('/')
        .filter(Boolean);
    const params = new URLSearchParams(href.search || '');
    if (parts[1] === 'library' && parts[2]) {
        if (parts[3] === 'collection' && parts[4]) {
            return { kind: 'collection', sectionKey: parts[2], ratingKey: parts[4] };
        }
        const tab = parts[3] === 'browse' || parts[3] === 'collections' ? parts[3] : 'home';
        return { kind: 'library', sectionKey: parts[2], tab };
    }
    if (parts[1] === 'collection' && parts[2]) {
        return { kind: 'collection', sectionKey: '', ratingKey: parts[2] };
    }
    if (parts[1] === 'playlists') return { kind: 'playlists' };
    if (parts[1] === 'playlist' && parts[2]) {
        return { kind: 'playlist', ratingKey: parts[2] };
    }
    if (parts[1] === 'hub') {
        const path = String(params.get('path') || '').trim();
        const hubPath = path.includes('::') ? path.slice(path.indexOf('::') + 2) : path;
        if (hubPath.startsWith('/library/') || hubPath.startsWith('/hubs/')) {
            return {
                kind: 'hub',
                path,
                title: params.get('title') || '',
                identifier: params.get('id') || '',
            };
        }
    }
    if (parts[1] === 'settings') return { kind: 'settings' };
    if (parts[1] === 'watchlist') return { kind: 'watchlist' };
    if (parts[1] === 'item' && parts[2]) {
        return { kind: 'item', ratingKey: parts[2], serverId: params.get('server') || '' };
    }
    if (parts[1] === 'person' && parts[2]) {
        return {
            kind: 'person',
            actorId: decodeURIComponent(parts[2]),
            name: params.get('name') || '',
            thumb: params.get('thumb') || '',
        };
    }
    if (parts[1] === 'studio' && parts[2]) {
        return {
            kind: 'studio',
            studioKey: decodeURIComponent(parts[2]),
            name: params.get('name') || '',
            sectionKey: params.get('section') || '',
            mediaType: params.get('type') === 'movie' ? 'movie' : params.get('type') === 'show' ? 'show' : undefined,
        };
    }
    return { kind: 'home' };
};

const libraryPath = (sectionKey: string, tab: LibraryTab = 'home') => (
    tab === 'home'
        ? `${PLAYER_APP_BASE}/library/${encodeURIComponent(sectionKey)}`
        : `${PLAYER_APP_BASE}/library/${encodeURIComponent(sectionKey)}/${tab}`
);

const viewScreenMotionKey = (view: PlayerView): string => {
    switch (view.kind) {
        case 'library':
            return `library:${view.sectionKey}:${view.tab}`;
        case 'collection':
            return `collection:${view.ratingKey}`;
        case 'playlists':
            return 'playlists';
        case 'playlist':
            return `playlist:${view.ratingKey}`;
        case 'hub':
            return `hub:${view.path}`;
        case 'item':
            return `item:${view.serverId}:${view.ratingKey}`;
        case 'person':
            return `person:${view.actorId}`;
        case 'studio':
            return `studio:${view.studioKey}`;
        case 'settings':
            return 'settings';
        case 'watchlist':
            return 'watchlist';
        default:
            return 'home';
    }
};

const screenEnterClass = (tvShell: boolean, animate = true) => (
    tvShell ? (animate ? 'smp-tv-screen-enter' : '') : 'animate-fade-in'
);

export const MediaPlayerDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    const [settings] = usePlayerSettings();
    const [view, setView] = useState<PlayerView>(() => readPlayerView());
    const [libraries, setLibraries] = useState<PlayerSection[]>(() => readPlayerLibrariesCache());
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [playSession, setPlaySession] = useState<PlayerPlaySession | null>(null);
    const playSessionRef = useRef<PlayerPlaySession | null>(null);
    playSessionRef.current = playSession;
    /** Keep a black bridge while ExoPlayer closes and the next episode opens. */
    const [playNextBridge, setPlayNextBridge] = useState(false);
    const closingToOverviewRef = useRef(false);
    const [playNextQueue, setPlayNextQueue] = useState<PlayerItem[]>([]);
    const [isAdmin, setIsAdmin] = useState(false);
    const [startingPlay, setStartingPlay] = useState(false);
    const startingPlayRef = useRef(false);
    const [pendingResume, setPendingResume] = useState<PendingResume | null>(null);
    const [pendingStillWatching, setPendingStillWatching] = useState<{ item: PlayerItem; opts: PlayerPlayOptions } | null>(null);
    const autoplayStreakRef = useRef(0);
    const [navExpanded, setNavExpanded] = useState(() => {
        try {
            if (typeof window !== 'undefined' && (window.__PLEX_CLIENT__?.isTv || document.documentElement?.dataset?.tv === '1')) {
                return false;
            }
        } catch {
            /* ignore */
        }
        return readPlayerNavExpanded();
    });
    const [keepHome, setKeepHome] = useState(() => view.kind === 'home');
    const [keepLibrary, setKeepLibrary] = useState<{ sectionKey: string; tab: LibraryTab } | null>(
        () => (view.kind === 'library' ? { sectionKey: view.sectionKey, tab: view.tab } : null),
    );
    const [tvScreenEnter, setTvScreenEnter] = useState(true);
    const [tvShell, setTvShell] = useState(() => {
        try {
            return !!(
                typeof window !== 'undefined'
                && (window.__PLEX_CLIENT__?.isTv || document.documentElement?.dataset?.tv === '1')
            );
        } catch {
            return false;
        }
    });
    const viewKindRef = useRef(view.kind);

    useEffect(() => {
        const syncTv = () => {
            try {
                const tv = !!(
                    window.__PLEX_CLIENT__?.isTv
                    || document.documentElement?.dataset?.tv === '1'
                );
                setTvShell(tv);
                if (tv) {
                    delete document.documentElement.dataset.phone;
                    return;
                }
                if (document.documentElement.dataset.phoneNative === '1') {
                    document.documentElement.dataset.phone = '1';
                    return;
                }
                const phone = window.matchMedia('(hover: none) and (pointer: coarse)').matches
                    || window.matchMedia('(max-width: 767px)').matches
                    || (/Android/i.test(navigator.userAgent || '') && (/Mobile/i.test(navigator.userAgent || '') || /; wv\)/.test(navigator.userAgent || '')));
                if (phone) document.documentElement.dataset.phone = '1';
                else delete document.documentElement.dataset.phone;
            } catch {
                /* ignore */
            }
        };
        syncTv();
        const id = window.setInterval(syncTv, 500);
        window.setTimeout(() => window.clearInterval(id), 4000);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (!tvShell) {
            try { delete document.documentElement.dataset.reduceMotion; } catch { /* ignore */ }
            return;
        }
        try {
            if (settings.reduceMotion) document.documentElement.dataset.reduceMotion = '1';
            else delete document.documentElement.dataset.reduceMotion;
        } catch {
            /* ignore */
        }
    }, [settings.reduceMotion, tvShell]);

    const syncFromLocation = useCallback(() => {
        setView(readPlayerView());
    }, []);

    const onPopState = useCallback(() => {
        setTvScreenEnter(false);
        setView(readPlayerView());
    }, []);

    useEffect(() => {
        try {
            if (window.__PLEX_CLIENT__?.isTv || document.documentElement?.dataset?.tv === '1') {
                setNavExpanded(false);
            }
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        const onTvNav = (event: Event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (action === 'open') {
                setNavExpanded(true);
                try {
                    document.documentElement.dataset.tvNavOpen = '1';
                } catch {
                    /* ignore */
                }
                return;
            }
            if (action === 'close') {
                setNavExpanded(false);
                try {
                    delete document.documentElement.dataset.tvNavOpen;
                } catch {
                    /* ignore */
                }
            }
        };
        window.addEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
        return () => window.removeEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
    }, []);

    const viewKey = (
        view.kind === 'item' ? `item:${view.serverId}:${view.ratingKey}`
        : view.kind === 'person' ? `person:${view.actorId}`
        : view.kind === 'studio' ? `studio:${view.studioKey}`
        : view.kind === 'library' ? `library:${view.sectionKey}:${view.tab}`
        : view.kind === 'collection' ? `collection:${view.sectionKey}:${view.ratingKey}`
        : view.kind === 'playlist' ? `playlist:${view.ratingKey}`
        : view.kind === 'hub' ? `hub:${view.path}`
        : view.kind
    );

    useEffect(() => {
        const previous = viewKindRef.current;
        viewKindRef.current = view.kind;
        if (view.kind === 'home') setKeepHome(true);
        if (view.kind === 'library') {
            setKeepLibrary({ sectionKey: view.sectionKey, tab: view.tab });
            rememberLastLibraryPath(libraryPath(view.sectionKey, view.tab));
        } else if (
            view.kind === 'home'
            || view.kind === 'watchlist'
            || view.kind === 'playlists'
            || view.kind === 'settings'
        ) {
            setKeepLibrary(null);
        }
        if (view.kind === 'library' && previous !== 'library') return restorePlayerLibraryScrollWhenReady();
        if (view.kind !== 'home' || previous === 'home') return undefined;
        return restorePlayerHomeScrollWhenReady();
    }, [tvShell, view]);

    useLayoutEffect(() => {
        const previous = viewKindRef.current;
        if (previous === 'home' && view.kind !== 'home') stashPlayerHomeScroll();
        if (previous === 'library' && view.kind !== 'library') stashPlayerLibraryScroll();
        if (view.kind === 'home') return;
        if (view.kind === 'library') {
            restorePlayerLibraryScroll();
            return;
        }
        writePlayerScrollTop(0);
    }, [view.kind, viewKey]);

    useEffect(() => {
        window.addEventListener('popstate', onPopState);
        window.addEventListener(PLAYER_NAVIGATE_EVENT, syncFromLocation);
        return () => {
            window.removeEventListener('popstate', onPopState);
            window.removeEventListener(PLAYER_NAVIGATE_EVENT, syncFromLocation);
        };
    }, [onPopState, syncFromLocation]);

    useEffect(() => {
        let cancelled = false;
        fetchMediaPlayerLibraries()
            .then((data) => {
                if (!cancelled && !data.stale) setLibraries(data.libraries || []);
            })
            .catch(() => {
                if (!cancelled) setLibraries([]);
            });
        fetchMediaPlayerMe()
            .then((me) => {
                if (!cancelled) setIsAdmin(Boolean(me?.isAdmin));
            })
            .catch(() => {
                if (!cancelled) setIsAdmin(false);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const refresh = () => {
            void fetchMediaPlayerLibraries()
                .then((data) => {
                    if (!data.stale) setLibraries(data.libraries || []);
                })
                .catch(() => undefined);
        };
        window.addEventListener(PLAYER_SERVERS_EVENT, refresh);
        return () => window.removeEventListener(PLAYER_SERVERS_EVENT, refresh);
    }, []);

    const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToasts((prev) => appendToast(prev, message, type));
    }, []);

    const enqueuePlayNext = useCallback((item: PlayerItem) => {
        if (!item?.ratingKey) return;
        setPlayNextQueue((prev) => {
            const without = prev.filter((row) => row.ratingKey !== item.ratingKey);
            return [item, ...without];
        });
    }, []);

    const consumePlayNext = useCallback(() => {
        setPlayNextQueue((prev) => prev.slice(1));
    }, []);

    const navigate = useCallback((path: string) => {
        // Stay on the Capacitor/WebView origin. portalUrl() is absolute to the StreamPilot host
        // and breaks history.pushState (cross-origin) so poster clicks never open overview.
        window.history.pushState({}, '', path);
        setTvScreenEnter(true);
        setView(readPlayerView());
        window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
    }, []);

    const openItem = useCallback((item: PlayerItem) => {
        if (!item?.ratingKey) return;
        if (isAndroidTvUi()) captureTvFocusSnapshot();
        rememberTvFocusKey(item.ratingKey);
        if (view.kind === 'library') stashPlayerLibraryScroll();
        if (item.type === 'person') {
            const actorId = String(item.personId || item.ratingKey).trim();
            if (!actorId) return;
            const qs = new URLSearchParams();
            const name = String(item.personName || item.title || '').trim();
            if (name) qs.set('name', name);
            if (item.thumb) qs.set('thumb', item.thumb);
            const suffix = qs.toString() ? `?${qs}` : '';
            navigate(`${PLAYER_APP_BASE}/person/${encodeURIComponent(actorId)}${suffix}`);
            return;
        }
        if (item.type === 'collection') {
            const section = String(item.librarySectionID || '').trim();
            if (section) {
                navigate(`${PLAYER_APP_BASE}/library/${encodeURIComponent(section)}/collection/${encodeURIComponent(item.ratingKey)}`);
            } else {
                navigate(`${PLAYER_APP_BASE}/collection/${encodeURIComponent(item.ratingKey)}`);
            }
            return;
        }
        if (item.type === 'playlist') {
            navigate(`${PLAYER_APP_BASE}/playlist/${encodeURIComponent(item.ratingKey)}`);
            return;
        }
        seedPlayerItemNav(item);
        const serverQs = item.serverId ? `?server=${encodeURIComponent(item.serverId)}` : '';
        navigate(`${PLAYER_APP_BASE}/item/${encodeURIComponent(item.ratingKey)}${serverQs}`);
    }, [navigate, view.kind]);

    const openLibrary = useCallback((section: PlayerSection, tab: LibraryTab = 'home') => {
        if (!section?.key) return;
        const path = libraryPath(section.key, tab);
        rememberLastLibraryPath(path);
        navigate(path);
    }, [navigate]);

    const openCollection = useCallback((sectionKey: string, item: PlayerItem) => {
        if (!item?.ratingKey) return;
        navigate(`${PLAYER_APP_BASE}/library/${encodeURIComponent(sectionKey)}/collection/${encodeURIComponent(item.ratingKey)}`);
    }, [navigate]);

    const openHub = useCallback((hub: Pick<PlayerLibraryHub, 'title' | 'identifier' | 'hubKey' | 'collectionRatingKey' | 'playlistRatingKey'>) => {
        if (hub.collectionRatingKey) {
            openItem({
                ratingKey: hub.collectionRatingKey,
                title: hub.title,
                type: 'collection',
            });
            return;
        }
        if (hub.playlistRatingKey) {
            openItem({
                ratingKey: hub.playlistRatingKey,
                title: hub.title,
                type: 'playlist',
            });
            return;
        }
        const path = String(hub.hubKey || '').trim();
        const hubPath = path.includes('::') ? path.slice(path.indexOf('::') + 2) : path;
        if (!hubPath.startsWith('/library/') && !hubPath.startsWith('/hubs/')) return;
        const qs = new URLSearchParams({ path, title: hub.title || '' });
        if (hub.identifier) qs.set('id', hub.identifier);
        navigate(`${PLAYER_APP_BASE}/hub?${qs.toString()}`);
    }, [navigate, openItem]);

    const openPerson = useCallback((person: PlayerPersonRef) => {
        const actorId = String(person?.id || person?.name || '').trim();
        if (!actorId) return;
        const qs = new URLSearchParams();
        if (person.name) qs.set('name', person.name);
        if (person.thumb) qs.set('thumb', person.thumb);
        const suffix = qs.toString() ? `?${qs}` : '';
        navigate(`${PLAYER_APP_BASE}/person/${encodeURIComponent(actorId)}${suffix}`);
    }, [navigate]);

    const openStudio = useCallback((studio: { key: string; name: string; sectionKey?: string; mediaType?: 'movie' | 'show' }) => {
        const studioKey = String(studio?.key || studio?.name || '').trim();
        if (!studioKey) return;
        const qs = new URLSearchParams();
        if (studio.name) qs.set('name', studio.name);
        if (studio.sectionKey) qs.set('section', studio.sectionKey);
        if (studio.mediaType) qs.set('type', studio.mediaType);
        const suffix = qs.toString() ? `?${qs}` : '';
        navigate(`${PLAYER_APP_BASE}/studio/${encodeURIComponent(studioKey)}${suffix}`);
    }, [navigate]);

    const goHome = useCallback(() => {
        requestPlayerHomeReset();
        navigate(PLAYER_APP_BASE);
    }, [navigate]);

    const goWatchlist = useCallback(() => {
        navigate(`${PLAYER_APP_BASE}/watchlist`);
    }, [navigate]);

    const goPlaylists = useCallback(() => {
        navigate(`${PLAYER_APP_BASE}/playlists`);
    }, [navigate]);

    const openSearch = useCallback(() => {
        requestPlayerSearchFocus();
        if (view.kind !== 'home') navigate(PLAYER_APP_BASE);
        window.setTimeout(() => {
            if (focusPlayerSearchInput()) consumePlayerSearchFocus();
        }, 80);
    }, [navigate, view.kind]);

    useEffect(() => {
        window.__SMP_OPEN_SEARCH__ = openSearch;
        return () => {
            if (window.__SMP_OPEN_SEARCH__ === openSearch) delete window.__SMP_OPEN_SEARCH__;
        };
    }, [openSearch]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
            const tag = String((event.target as HTMLElement | null)?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            event.preventDefault();
            openSearch();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openSearch]);

    const goBack = useCallback(() => {
        if (window.history.length > 1) window.history.back();
        else goHome();
    }, [goHome]);

    const startPlayback = useCallback(async (item: PlayerItem, opts: PlayerPlayOptions = {}) => {
        if (startingPlayRef.current || playSessionRef.current) return;
        startingPlayRef.current = true;
        if (isAndroidTvUi()) captureTvFocusSnapshot();
        setStartingPlay(true);
        setPendingResume(null);
        setPlayNextBridge(true);
        try {
            const savedAv = readAvChoice(item.grandparentRatingKey || item.parentRatingKey, item.ratingKey);
            const rememberedIndex = opts.mediaIndex != null
                ? opts.mediaIndex
                : (readMediaIndexChoice(item.ratingKey) ?? undefined);
            if (rememberedIndex != null) writeMediaIndexChoice(item.ratingKey, rememberedIndex);
            const baseOpts = {
                offsetMs: opts.offsetMs,
                qualityId: resolveStartPlaybackQualityId(opts.qualityId, settings.defaultQualityId),
                mediaIndex: rememberedIndex,
                audioLanguage: savedAv?.audioLanguage || settings.audioLanguage,
                subtitleMode: settings.subtitleMode,
                serverId: item.serverId,
            };
            let session = await startMediaPlayerPlayback(item.ratingKey, {
                ...baseOpts,
                audioStreamId: opts.audioStreamId !== undefined ? opts.audioStreamId : undefined,
                subtitleStreamId: opts.subtitleStreamId !== undefined ? opts.subtitleStreamId : undefined,
            });
            if (opts.audioStreamId === undefined || opts.subtitleStreamId === undefined) {
                const resolved = resolveAvChoiceForTracks(
                    savedAv,
                    session.audioTracks || [],
                    session.subtitles || [],
                );
                const nextAudio = opts.audioStreamId !== undefined
                    ? opts.audioStreamId
                    : (resolved.audioStreamId || session.audioStreamId || undefined);
                const nextSub = opts.subtitleStreamId !== undefined
                    ? opts.subtitleStreamId
                    : (resolved.subtitleStreamId !== undefined
                        ? resolved.subtitleStreamId
                        : (session.subtitleStreamId || undefined));
                const audioDiff = nextAudio != null && String(nextAudio) !== String(session.audioStreamId || '');
                const subDiff = nextSub != null && String(nextSub || '') !== String(session.subtitleStreamId || '');
                if (audioDiff || subDiff) {
                    session = await startMediaPlayerPlayback(item.ratingKey, {
                        ...baseOpts,
                        audioStreamId: nextAudio,
                        subtitleStreamId: nextSub,
                    });
                }
            }
            setPlaySession(session);
            setPlayNextBridge(false);
        } catch (error: any) {
            setPlayNextBridge(false);
            setToasts((prev) => appendToast(prev, String(error?.message || t('mediaPlayerPage.playError')), 'error'));
        } finally {
            startingPlayRef.current = false;
            setStartingPlay(false);
        }
    }, [settings.audioLanguage, settings.defaultQualityId, settings.subtitleMode, t]);

    const playItem = useCallback(async (item: PlayerItem, opts: PlayerPlayOptions = {}) => {
        if (opts.fromAutoplay) {
            const askAfter = Number(settings.stillWatchingAfter);
            if (Number.isFinite(askAfter) && askAfter > 0 && autoplayStreakRef.current >= askAfter) {
                setPlayNextBridge(false);
                setPlaySession(null);
                setPendingStillWatching({ item, opts: { ...opts, fromAutoplay: false } });
                return;
            }
            autoplayStreakRef.current += 1;
        } else {
            autoplayStreakRef.current = 0;
            setPendingStillWatching(null);
        }
        let target = item;
        let nextOpts: PlayerPlayOptions = { ...opts };
        if (opts.queue?.length) {
            const playable = opts.queue.filter((row) => row?.ratingKey);
            if (!playable.length) {
                setToasts((prev) => appendToast(prev, t('mediaPlayerPage.notPlayable'), 'error'));
                return;
            }
            const [first, ...rest] = playable;
            setPlayNextQueue(rest);
            target = first;
            nextOpts = { ...opts, queue: undefined, shuffle: false, playFromHere: false };
        } else if ((
            opts.shuffle
            || opts.playFromHere
            || item.type === 'show'
            || item.type === 'season'
            || item.type === 'album'
            || item.type === 'artist'
            || item.type === 'track'
        ) && item.ratingKey) {
            try {
                const data = opts.shuffle
                    ? await fetchMediaPlayerShuffleQueue(item.ratingKey, item.serverId)
                    : await fetchMediaPlayerPlayFromQueue(item.ratingKey, item.serverId);
                let rows = (data.items || []).filter((row) => row?.ratingKey);
                if (!opts.shuffle && (item.type === 'show' || item.type === 'season') && !opts.playFromHere) {
                    rows = sliceQueueToNextUnwatched(rows);
                }
                if (!rows.length) {
                    setToasts((prev) => appendToast(prev, t('mediaPlayerPage.notPlayable'), 'error'));
                    return;
                }
                const [first, ...rest] = rows;
                setPlayNextQueue(rest);
                target = first;
                nextOpts = {
                    ...opts,
                    shuffle: false,
                    playFromHere: false,
                    skipResume: opts.shuffle ? true : opts.skipResume,
                    offsetMs: opts.shuffle ? 0 : opts.offsetMs,
                };
            } catch (error: any) {
                setToasts((prev) => appendToast(prev, String(error?.message || t('mediaPlayerPage.playError')), 'error'));
                return;
            }
        }
        if (target?.type === 'playlist' && target.ratingKey) {
            navigate(`${PLAYER_APP_BASE}/playlist/${encodeURIComponent(target.ratingKey)}`);
            return;
        }
        const extraPlayable = target?.type === 'clip' || target?.type === 'trailer' || !!target?.extraType || !!target?.extraSubtype;
        if ((!target?.canPlay && !extraPlayable) || !target.ratingKey) {
            setToasts((prev) => appendToast(prev, t('mediaPlayerPage.notPlayable'), 'error'));
            return;
        }
        const playableType = target.type === 'movie' || target.type === 'episode' || target.type === 'clip' || target.type === 'trailer' || target.type === 'track';
        if (!nextOpts.skipResume && playableType && shouldOfferResume(target, nextOpts.offsetMs)) {
            setPendingResume({
                item: target,
                offsetMs: nextOpts.offsetMs == null ? Number(target.viewOffsetMs || 0) : Number(nextOpts.offsetMs),
                mediaIndex: nextOpts.mediaIndex,
                audioStreamId: nextOpts.audioStreamId,
                subtitleStreamId: nextOpts.subtitleStreamId,
            });
            return;
        }
        const fromStart = !(Number(nextOpts.offsetMs) > 0);
        if (
            settings.cinemaTrailers
            && target.type === 'movie'
            && fromStart
            && !isPlayerTrailer(target)
            && target.ratingKey
        ) {
            let extras = readPlayerItemCache(target.ratingKey)?.extras || [];
            if (!extras.length) {
                const more = await fetchMediaPlayerItemMore(target.ratingKey, target.serverId).catch(() => null);
                extras = more?.extras || [];
            }
            const trailers = extras.filter((row) => isPlayerTrailer(row) && row.ratingKey).slice(0, 2);
            if (trailers.length) {
                setPlayNextQueue((prev) => [...trailers.slice(1), target, ...prev.filter((row) => row.ratingKey !== target.ratingKey)]);
                target = trailers[0];
                nextOpts = { ...nextOpts, skipResume: true, offsetMs: 0 };
            }
        }
        await startPlayback(target, nextOpts);
    }, [navigate, settings.cinemaTrailers, settings.stillWatchingAfter, startPlayback, t]);

    useEffect(() => {
        if (playSession) {
            setPlayNextBridge(false);
            return undefined;
        }
        if (!isAndroidTvUi()) return undefined;
        // Returning to a title overview — don't yank focus back to Home.
        if (closingToOverviewRef.current) {
            closingToOverviewRef.current = false;
            return undefined;
        }
        const id = window.setTimeout(() => restoreTvFocusWhenReady(), 120);
        return () => window.clearTimeout(id);
    }, [playSession]);

    useEffect(() => {
        if (!pendingResume) return undefined;
        const id = window.setTimeout(() => {
            const btn = document.querySelector<HTMLElement>('[data-tv-resume-primary="1"]');
            btn?.focus();
        }, 40);
        return () => window.clearTimeout(id);
    }, [pendingResume]);

    useEffect(() => {
        if (!pendingStillWatching) return undefined;
        const id = window.setTimeout(() => {
            const btn = document.querySelector<HTMLElement>('[data-tv-still-watching-primary="1"]');
            btn?.focus();
        }, 40);
        return () => window.clearTimeout(id);
    }, [pendingStillWatching]);

    const openSettings = useCallback(() => navigate(`${PLAYER_APP_BASE}/settings`), [navigate]);
    const toggleNavExpanded = useCallback(() => {
        setNavExpanded((current) => {
            const next = !current;
            writePlayerNavExpanded(next);
            return next;
        });
    }, []);
    const navPage = view.kind === 'home'
        ? 'home'
        : view.kind === 'watchlist'
            ? 'watchlist'
            : view.kind === 'playlists' || view.kind === 'playlist'
                ? 'playlists'
            : view.kind === 'settings'
                ? 'settings'
                : view.kind === 'library' || view.kind === 'collection'
                    ? 'library'
                    : 'other';
    const activeLibraryKey = view.kind === 'library' || view.kind === 'collection' ? view.sectionKey : undefined;
    const networkOnline = usePlayerNetworkStatus();
    const isItemView = view.kind === 'item';
    const phoneNav = !tvShell && navPage !== 'other';
    const navContentInset = tvShell
        ? (navExpanded ? '18.5rem' : '6.75rem')
        : (navExpanded ? '18.25rem' : '6.5rem');

    return (
        <div className="relative flex h-full min-h-0 w-full flex-col">
            {tvShell && !playSession ? <PlayerTvClock /> : null}
            <MediaPlayerNav
                libraries={libraries}
                libraryOrder={settings.libraryNavOrder}
                page={navPage}
                activeLibraryKey={activeLibraryKey}
                expanded={navExpanded}
                onToggleExpanded={toggleNavExpanded}
                onHome={goHome}
                onWatchlist={goWatchlist}
                onSearch={openSearch}
                onOpenLibrary={openLibrary}
                onOpenPlaylists={goPlaylists}
                onOpenSettings={openSettings}
                playlistsEnabled={settings.showPlaylists}
                offline={tvShell && !networkOnline}
            />
            <div
                id={PLAYER_SCROLL_ID}
                className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-clip ${
                    tvShell ? 'hide-scrollbar' : 'custom-scrollbar'
                } ${
                    isItemView
                        ? 'player-scroll-details px-0 py-0'
                        : `${tvShell ? 'pr-4' : 'px-4'} py-4 md:py-6 md:pr-6 ${
                            phoneNav ? 'player-scroll-phone-nav' : ''
                        } ${
                            navExpanded
                                ? (tvShell ? 'pl-[18.5rem]' : 'md:pl-[18.25rem]')
                                : (tvShell ? 'pl-[6.75rem]' : 'md:pl-[6.5rem]')
                        }`
                } ${playSession ? 'pb-36' : ''}`}
                style={isItemView ? { '--player-nav-inset': navContentInset } as React.CSSProperties : undefined}
            >
                <div className={`mx-auto flex w-full flex-col ${isItemView ? 'max-w-none gap-0' : 'max-w-[2400px] gap-4'}`}>
            {keepHome ? (
                <div className={view.kind === 'home' ? '' : 'hidden'} hidden={view.kind !== 'home'}>
                    <MediaPlayerHome
                        active={view.kind === 'home'}
                        onOpenItem={openItem}
                        onPlay={playItem}
                        onOpenLibrary={openLibrary}
                        onOpenHub={openHub}
                        onOpenWatchlist={goWatchlist}
                        onPlayNext={enqueuePlayNext}
                        onToast={notify}
                        isAdmin={isAdmin}
                        playlistsEnabled={settings.showPlaylists}
                    />
                </div>
            ) : null}
            {view.kind === 'watchlist' ? (
                <div key="watchlist" className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <MediaPlayerWatchlist
                        onBack={goHome}
                        onOpenItem={openItem}
                        onPlay={playItem}
                        onPlayNext={enqueuePlayNext}
                        onToast={notify}
                        isAdmin={isAdmin}
                        playlistsEnabled={settings.showPlaylists}
                    />
                </div>
            ) : null}
            {view.kind === 'playlists' ? (
                <div key="playlists" className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <MediaPlayerPlaylists
                        onBack={goHome}
                        onOpenItem={openItem}
                        onPlay={playItem}
                        onPlayNext={enqueuePlayNext}
                        onToast={notify}
                        isAdmin={isAdmin}
                        playlistsEnabled={settings.showPlaylists}
                    />
                </div>
            ) : null}
            {view.kind === 'settings' ? (
                <div key="settings" className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <MediaPlayerSettings onBack={goHome} isAdmin={isAdmin} />
                </div>
            ) : null}
            {(view.kind === 'library' || keepLibrary) ? (
                <div
                    className={view.kind === 'library' ? screenEnterClass(tvShell, tvScreenEnter) : 'hidden'}
                    hidden={view.kind !== 'library'}
                >
                <MediaPlayerLibrary
                    sectionKey={view.kind === 'library' ? view.sectionKey : keepLibrary!.sectionKey}
                    tab={view.kind === 'library' ? view.tab : keepLibrary!.tab}
                    active={view.kind === 'library'}
                    onBack={goHome}
                    onOpenItem={openItem}
                    onOpenCollection={openCollection}
                    onOpenHub={openHub}
                    onChangeTab={(tab) => navigate(libraryPath(
                        view.kind === 'library' ? view.sectionKey : keepLibrary!.sectionKey,
                        tab,
                    ))}
                    onPlay={playItem}
                    onPlayNext={enqueuePlayNext}
                    onToast={notify}
                    isAdmin={isAdmin}
                    playlistsEnabled={settings.showPlaylists}
                />
                </div>
            ) : null}
            {view.kind === 'collection' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerCollection
                    ratingKey={view.ratingKey}
                    sectionKey={view.sectionKey}
                    onBack={() => (
                        view.sectionKey
                            ? navigate(libraryPath(view.sectionKey, 'collections'))
                            : goBack()
                    )}
                    onOpenItem={openItem}
                    onPlay={playItem}
                />
                </div>
            ) : null}
            {view.kind === 'playlist' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerPlaylist
                    ratingKey={view.ratingKey}
                    onBack={goPlaylists}
                    onPlay={playItem}
                />
                </div>
            ) : null}
            {view.kind === 'hub' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerHub
                    path={view.path}
                    title={view.title}
                    identifier={view.identifier}
                    onBack={goBack}
                    onOpenItem={openItem}
                    onPlay={playItem}
                />
                </div>
            ) : null}
            {view.kind === 'item' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerDetails
                    ratingKey={view.ratingKey}
                    serverId={view.serverId}
                    onBack={goBack}
                    onOpenItem={openItem}
                    onOpenPerson={openPerson}
                    onOpenStudio={openStudio}
                    onPlay={playItem}
                    onPlayNext={enqueuePlayNext}
                    onToast={notify}
                    isAdmin={isAdmin}
                    playlistsEnabled={settings.showPlaylists}
                    playing={startingPlay}
                    playbackActive={Boolean(playSession)}
                />
                </div>
            ) : null}
            {view.kind === 'person' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerPerson
                    actorId={view.actorId}
                    name={view.name}
                    thumb={view.thumb}
                    onBack={goBack}
                    onOpenItem={openItem}
                    onPlay={playItem}
                />
                </div>
            ) : null}
            {view.kind === 'studio' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerStudio
                    studioKey={view.studioKey}
                    name={view.name}
                    sectionKey={view.sectionKey}
                    mediaType={view.mediaType}
                    onBack={goBack}
                    onOpenItem={openItem}
                    onPlay={playItem}
                />
                </div>
            ) : null}
            {pendingResume ? (
                <PlayerResumeDialog
                    item={pendingResume.item}
                    offsetMs={pendingResume.offsetMs}
                    tvShell={tvShell}
                    onResume={() => void startPlayback(pendingResume.item, {
                        offsetMs: pendingResume.offsetMs,
                        mediaIndex: pendingResume.mediaIndex,
                        audioStreamId: pendingResume.audioStreamId,
                        subtitleStreamId: pendingResume.subtitleStreamId,
                        skipResume: true,
                    })}
                    onStartOver={() => void startPlayback(pendingResume.item, {
                        offsetMs: 0,
                        mediaIndex: pendingResume.mediaIndex,
                        audioStreamId: pendingResume.audioStreamId,
                        subtitleStreamId: pendingResume.subtitleStreamId,
                        skipResume: true,
                    })}
                    onClose={() => setPendingResume(null)}
                />
            ) : null}
            {pendingStillWatching ? (
                <PlayerStillWatchingDialog
                    item={pendingStillWatching.item}
                    tvShell={tvShell}
                    onContinue={() => {
                        const pending = pendingStillWatching;
                        setPendingStillWatching(null);
                        autoplayStreakRef.current = 0;
                        void playItem(pending.item, { ...pending.opts, fromAutoplay: false, skipResume: true });
                    }}
                    onStop={() => {
                        setPendingStillWatching(null);
                        autoplayStreakRef.current = 0;
                    }}
                />
            ) : null}
            {playSession ? (
                <MediaPlayerVideo
                    session={playSession}
                    onClose={(meta) => {
                        const item = meta?.item || playSession.item;
                        const chaining = !!meta?.playNext;
                        if (chaining) {
                            setPlayNextBridge(true);
                            setPlaySession(null);
                            return;
                        }
                        setPlayNextBridge(false);
                        setPlaySession(null);
                        // Movies / episodes (incl. last episode): land on the overview, not a blank Home.
                        if (item?.ratingKey && (
                            item.type === 'movie'
                            || item.type === 'episode'
                            || item.type === 'clip'
                            || item.type === 'trailer'
                        )) {
                            closingToOverviewRef.current = true;
                            openItem(item);
                        }
                    }}
                    onPlaybackError={(message) => notify(message, 'error')}
                    autoplayNext={settings.autoplayNext}
                    autoSkipIntro={settings.autoSkipIntro}
                    autoSkipCredits={settings.autoSkipCredits}
                    playNextQueue={playNextQueue}
                    onConsumePlayNext={consumePlayNext}
                    onPlayItem={playItem}
                />
            ) : null}
            {playNextBridge && !playSession ? (
                <div className="fixed inset-0 z-[4000] bg-black" aria-hidden data-tv-playback-overlay="1" />
            ) : null}
            <ToastContainer toasts={toasts} setToasts={setToasts} />
                </div>
            </div>
        </div>
    );
};
