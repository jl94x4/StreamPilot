import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    pushToast as appendToast,
    stripBasePath,
    ToastContainer,
    useDiscoverI18n,
    type ToastMessage,
} from './host';
import { fetchLiveTvSources, fetchMediaPlayerItem, fetchMediaPlayerItemMore, fetchMediaPlayerLibraries, fetchMediaPlayerMe, fetchMediaPlayerPlayFromQueue, fetchMediaPlayerServerStatus, fetchMediaPlayerShuffleQueue, resolveWatchTogetherLocalItem, startMediaPlayerPlayback, stopMediaPlayerTranscode, takePreparedMediaPlayerPlayback, tuneLiveTvChannel } from './api';
import { MediaPlayerHome } from './MediaPlayerHome';
import { MediaPlayerWatchlist } from './MediaPlayerWatchlist';
import { MediaPlayerDownloads } from './MediaPlayerDownloads';
import { MediaPlayerPlaylists } from './MediaPlayerPlaylists';
import { getMediaDownloadLocalUrl, isMediaDownloadsSupported } from '../plex-client/mediaDownloads';
import { isPhoneUi } from '../plex-client/config';
import { MediaPlayerCollection } from './MediaPlayerCollection';
import { MediaPlayerHub } from './MediaPlayerHub';
import { MediaPlayerPlaylist } from './MediaPlayerPlaylist';
import { MediaPlayerDetails } from './MediaPlayerDetails';
import { MediaPlayerStudio } from './MediaPlayerStudio';
import { lazyScreen, preloadScreensWhenIdle } from './lazyScreen';
import { MediaPlayerNav } from './MediaPlayerNav';
import { MediaPlayerNowPlayingChip } from './MediaPlayerNowPlayingChip';
import { WatchTogetherLobby } from './WatchTogetherLobby';
import {
    discardWatchTogetherClient,
    getWatchTogetherClient,
    type WtRoomState,
} from './watchTogetherClient';
import { captureTvFocusSnapshot, hasRememberedTvFocus, rememberTvFocusKey, restoreTvFocusWhenReady } from '../plex-client/useTvRemote';
import { isAndroidTvUi } from '../plex-client/config';
import { PLAYER_APP_BASE, PLAYER_NAVIGATE_EVENT, PLAYER_SCROLL_ID, PLAYER_TV_NAV_EVENT } from './paths';
import { usePlayerSettings } from './usePlayerSettings';
import { PlayerResumeDialog } from './PlayerResumeDialog';
import { PlayerStillWatchingDialog } from './PlayerStillWatchingDialog';
import {
    isMusicPlayerItem,
    isPlayerTrailer,
    MUSIC_NOW_PLAYING_EVENT,
    playSessionIdFromSrc,
    resolveStartPlaybackQualityId,
    shouldOfferResume,
    filterQueueUnwatched,
    shufflePlayerItems,
    sliceQueueToNextUnwatched,
    sliceQueueUnwatchedFromHere,
    type MusicNowPlayingDetail,
} from './playerUtils';
import {
    consumePlayerSearchFocus,
    focusPlayerSearchInput,
    PLAYER_LIBRARIES_EVENT,
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
    requestPlayerSearchQuery,
    restorePlayerHomeScrollWhenReady,
    restorePlayerLibraryScroll,
    restorePlayerLibraryScrollWhenReady,
    seedPlayerItemNav,
    stashPlayerHomeScroll,
    stashPlayerLibraryScroll,
    writePlayerNavExpanded,
    writePlayerScrollTop,
} from './playerMemory';
import type { PlayerItem, PlayerLibraryHub, PlayerPlayOptions, PlayerPlaySession, PlayerSection } from './types';

// Not needed for Home's first paint: loaded on first open, or at idle once Home has settled.
const MediaPlayerLibrary = lazyScreen(() => import('./MediaPlayerLibrary').then((m) => m.MediaPlayerLibrary));
const MediaPlayerPerson = lazyScreen(() => import('./MediaPlayerPerson').then((m) => m.MediaPlayerPerson));
const MediaPlayerSettings = lazyScreen(() => import('./MediaPlayerSettings').then((m) => m.MediaPlayerSettings));
const MediaPlayerVideo = lazyScreen(() => import('./MediaPlayerVideo').then((m) => m.MediaPlayerVideo));
const PlayerLiveTv = lazyScreen(() => import('./PlayerLiveTv').then((m) => m.PlayerLiveTv));

type PlayerPersonRef = { id: string; name: string; thumb?: string | null };
type LibraryTab = 'home' | 'browse' | 'collections' | 'studios';

const formatTvClock = (date: Date, hour24: boolean) => {
    const minutes = String(date.getMinutes()).padStart(2, '0');
    if (hour24) return `${String(date.getHours()).padStart(2, '0')}:${minutes}`;
    const hours = date.getHours();
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
};

const PlayerTvClock: React.FC = () => {
    const [settings] = usePlayerSettings();
    const hour24 = settings.clock24Hour !== false;
    const [label, setLabel] = useState(() => formatTvClock(new Date(), hour24));

    useEffect(() => {
        // Hours and minutes only: wake on the minute, not every second.
        let id = 0;
        const tick = () => {
            const now = new Date();
            setLabel(formatTvClock(now, hour24));
            window.clearTimeout(id);
            id = window.setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
        };
        tick();
        const onVisibility = () => {
            if (document.visibilityState !== 'hidden') tick();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            window.clearTimeout(id);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [hour24]);

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
    | { kind: 'livetv' }
    | { kind: 'downloads' }
    | { kind: 'settings' }
    | { kind: 'watchTogether'; mode: 'create'; ratingKey: string; serverId: string }
    | { kind: 'watchTogether'; mode: 'join'; inviteCode: string };

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
        const tab = parts[3] === 'browse' || parts[3] === 'collections' || parts[3] === 'studios'
            ? parts[3]
            : 'home';
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
    if (parts[1] === 'livetv') return { kind: 'livetv' };
    if (parts[1] === 'downloads') return { kind: 'downloads' };
    if (parts[1] === 'watch-together') {
        if (parts[2] === 'create') {
            const ratingKey = String(params.get('ratingKey') || '').trim();
            if (ratingKey) {
                return {
                    kind: 'watchTogether',
                    mode: 'create',
                    ratingKey,
                    serverId: params.get('server') || '',
                };
            }
        } else if (parts[2] === 'join') {
            const fromPath = parts[3] ? decodeURIComponent(parts[3]) : '';
            const fromQuery = String(params.get('code') || '').trim();
            return {
                kind: 'watchTogether',
                mode: 'join',
                inviteCode: (fromPath || fromQuery).toUpperCase(),
            };
        } else if (parts[2]) {
            // Short link: /media-player/watch-together/ABC123
            return { kind: 'watchTogether', mode: 'join', inviteCode: decodeURIComponent(parts[2]) };
        }
    }
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
        case 'watchTogether':
            return view.mode === 'create'
                ? `watchTogether:create:${view.serverId}:${view.ratingKey}`
                : `watchTogether:join:${view.inviteCode}`;
        case 'person':
            return `person:${view.actorId}`;
        case 'studio':
            return `studio:${view.studioKey}`;
        case 'settings':
            return 'settings';
        case 'watchlist':
            return 'watchlist';
        case 'downloads':
            return 'downloads';
        default:
            return 'home';
    }
};

const screenEnterClass = (tvShell: boolean, animate = true) => (
    tvShell ? (animate ? 'smp-tv-screen-enter' : '') : 'animate-fade-in'
);

export const MediaPlayerDashboard: React.FC = () => {
    const { t } = useDiscoverI18n();
    useEffect(() => preloadScreensWhenIdle([MediaPlayerLibrary, MediaPlayerSettings, MediaPlayerPerson, MediaPlayerVideo, PlayerLiveTv]), []);
    const [settings] = usePlayerSettings();
    const [view, setView] = useState<PlayerView>(() => readPlayerView());
    const [libraries, setLibraries] = useState<PlayerSection[]>(() => readPlayerLibrariesCache());
    const [offlineServerIds, setOfflineServerIds] = useState<string[]>([]);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [playSession, setPlaySession] = useState<PlayerPlaySession | null>(null);
    const playSessionRef = useRef<PlayerPlaySession | null>(null);
    playSessionRef.current = playSession;
    /** Keep a black bridge while ExoPlayer closes and the next episode opens. */
    const [playNextBridge, setPlayNextBridge] = useState(false);
    const playNextBridgeRef = useRef(false);
    playNextBridgeRef.current = playNextBridge;
    /** Bump to cancel an in-flight startPlayback (Back during play-next bridge). */
    const startPlaybackGenRef = useRef(0);
    /** Minimized music now-playing dock (TV): pad browse content and show global chip. */
    const [musicMinimized, setMusicMinimized] = useState(false);
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
    const [hasLiveTv, setHasLiveTv] = useState(false);
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

    useEffect(() => {
        try {
            if (tvShell && settings.liteBillboard) document.documentElement.dataset.liteBillboard = '1';
            else delete document.documentElement.dataset.liteBillboard;
        } catch {
            /* ignore */
        }
    }, [settings.liteBillboard, tvShell]);

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
        : view.kind === 'watchTogether' ? (
            view.mode === 'create'
                ? `watchTogether:create:${view.serverId}:${view.ratingKey}`
                : `watchTogether:join:${view.inviteCode}`
        )
        : view.kind === 'person' ? `person:${view.actorId}`
        : view.kind === 'studio' ? `studio:${view.studioKey}`
        : view.kind === 'library' ? `library:${view.sectionKey}:${view.tab}`
        : view.kind === 'collection' ? `collection:${view.sectionKey}:${view.ratingKey}`
        : view.kind === 'playlist' ? `playlist:${view.ratingKey}`
        : view.kind === 'hub' ? `hub:${view.path}`
        : view.kind
    );

    const [watchTogetherItem, setWatchTogetherItem] = useState<PlayerItem | null>(null);

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
            || view.kind === 'downloads'
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

    const applyLibraries = useCallback((rows: PlayerSection[] | null | undefined) => {
        const next = Array.isArray(rows)
            ? rows.filter((row) => row && String(row.key || '').trim())
            : [];
        setLibraries((prev) => {
            // Never wipe a good nav list with an empty/failed response.
            if (!next.length) return prev.length ? prev : readPlayerLibrariesCache();
            return next;
        });
        // A successful libraries payload means those PMS hosts answered — drop false offline marks.
        if (next.length) {
            const liveIds = new Set(
                next.map((row) => String(row.serverId || '').trim()).filter(Boolean),
            );
            if (liveIds.size) {
                setOfflineServerIds((prev) => prev.filter((id) => !liveIds.has(id)));
            } else {
                setOfflineServerIds([]);
            }
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadLibraries = () => {
            void fetchMediaPlayerLibraries()
                .then((data) => {
                    if (!cancelled && !data.stale) applyLibraries(data.libraries);
                })
                .catch(() => {
                    if (!cancelled) applyLibraries(readPlayerLibrariesCache());
                });
        };
        loadLibraries();
        fetchMediaPlayerMe()
            .then((me) => {
                if (!cancelled) setIsAdmin(Boolean(me?.isAdmin));
            })
            .catch(() => {
                if (!cancelled) setIsAdmin(false);
            });
        return () => { cancelled = true; };
    }, [applyLibraries]);

    useEffect(() => {
        const refresh = () => {
            void fetchMediaPlayerLibraries()
                .then((data) => {
                    if (!data.stale) applyLibraries(data.libraries);
                })
                .catch(() => applyLibraries(readPlayerLibrariesCache()));
        };
        const syncFromCache = () => {
            applyLibraries(readPlayerLibrariesCache());
        };
        const onTvNav = (event: Event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (action !== 'open') return;
            // Opening the rail: paint cache immediately, and refetch if still empty (boot race).
            const cached = readPlayerLibrariesCache();
            if (cached.length) applyLibraries(cached);
            else refresh();
        };
        window.addEventListener(PLAYER_SERVERS_EVENT, refresh);
        window.addEventListener(PLAYER_LIBRARIES_EVENT, syncFromCache);
        window.addEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
        return () => {
            window.removeEventListener(PLAYER_SERVERS_EVENT, refresh);
            window.removeEventListener(PLAYER_LIBRARIES_EVENT, syncFromCache);
            window.removeEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
        };
    }, [applyLibraries]);

    const refreshServerStatus = useCallback(() => {
        void fetchMediaPlayerServerStatus()
            .then((data) => {
                const rows = Array.isArray(data?.servers) ? data.servers : [];
                // Always replace — never sticky-accumulate false offline marks from a blip.
                const offline = rows
                    .filter((row) => row && row.online === false && String(row.id || '').trim())
                    .map((row) => String(row.id));
                setOfflineServerIds(offline);
            })
            .catch(() => {
                // Status probe failed (network blip) — do NOT paint every library offline.
                setOfflineServerIds([]);
            });
    }, []);

    useEffect(() => {
        refreshServerStatus();
        const id = window.setInterval(refreshServerStatus, 30000);
        const onOnline = () => refreshServerStatus();
        const onServers = () => refreshServerStatus();
        const onTvNav = (event: Event) => {
            if ((event as CustomEvent<{ action?: string }>).detail?.action === 'open') {
                refreshServerStatus();
            }
        };
        window.addEventListener('online', onOnline);
        window.addEventListener(PLAYER_SERVERS_EVENT, onServers);
        window.addEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
        return () => {
            window.clearInterval(id);
            window.removeEventListener('online', onOnline);
            window.removeEventListener(PLAYER_SERVERS_EVENT, onServers);
            window.removeEventListener(PLAYER_TV_NAV_EVENT, onTvNav);
        };
    }, [refreshServerStatus]);

    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            void fetchLiveTvSources()
                .then((data) => {
                    if (!cancelled) setHasLiveTv(Boolean(data?.available));
                })
                .catch(() => {
                    if (!cancelled) setHasLiveTv(false);
                });
        };
        refresh();
        window.addEventListener(PLAYER_SERVERS_EVENT, refresh);
        return () => {
            cancelled = true;
            window.removeEventListener(PLAYER_SERVERS_EVENT, refresh);
        };
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

    const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
        // Stay on the Capacitor/WebView origin. portalUrl() is absolute to the StreamPilot host
        // and breaks history.pushState (cross-origin) so poster clicks never open overview.
        if (opts?.replace) window.history.replaceState({}, '', path);
        else window.history.pushState({}, '', path);
        setTvScreenEnter(true);
        setView(readPlayerView());
        window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
    }, []);

    const openItem = useCallback((item: PlayerItem, rawOpts?: { replace?: boolean }) => {
        if (!item?.ratingKey) return;
        // TV / phone app: movie or show opened from another movie or show page (More like
        // this, collections) replaces that page, so Back leaves to where the first title
        // was opened from instead of walking every title. Show → season → episode still stacks.
        const appShell = isAndroidTvUi() || document.documentElement?.dataset?.phoneNative === '1';
        const fromKind = view.kind === 'item'
            ? document.querySelector<HTMLElement>('[data-tv-details="1"]')?.dataset?.tvKind
            : '';
        const titleToTitle = appShell
            && (fromKind === 'movie' || fromKind === 'show')
            && (item.type === 'movie' || item.type === 'show');
        const opts = titleToTitle ? { ...rawOpts, replace: true } : rawOpts;
        if (isAndroidTvUi()) {
            // Snapshot first. Do not replace a non-ratingKey focus target (e.g. view-more)
            // with the destination id — Back must return to the control that opened the title.
            if (!opts?.replace) {
                captureTvFocusSnapshot();
                if (!hasRememberedTvFocus()) rememberTvFocusKey(item.ratingKey);
            }
        } else if (!opts?.replace) {
            rememberTvFocusKey(item.ratingKey);
        }
        if (view.kind === 'library') stashPlayerLibraryScroll();
        if (item.type === 'person') {
            const actorId = String(item.personId || item.ratingKey).trim();
            if (!actorId) return;
            const qs = new URLSearchParams();
            const name = String(item.personName || item.title || '').trim();
            if (name) qs.set('name', name);
            if (item.thumb) qs.set('thumb', item.thumb);
            const suffix = qs.toString() ? `?${qs}` : '';
            navigate(`${PLAYER_APP_BASE}/person/${encodeURIComponent(actorId)}${suffix}`, opts);
            return;
        }
        if (item.type === 'collection') {
            const section = String(item.librarySectionID || '').trim();
            if (section) {
                navigate(`${PLAYER_APP_BASE}/library/${encodeURIComponent(section)}/collection/${encodeURIComponent(item.ratingKey)}`, opts);
            } else {
                navigate(`${PLAYER_APP_BASE}/collection/${encodeURIComponent(item.ratingKey)}`, opts);
            }
            return;
        }
        if (item.type === 'playlist') {
            navigate(`${PLAYER_APP_BASE}/playlist/${encodeURIComponent(item.ratingKey)}`, opts);
            return;
        }
        seedPlayerItemNav(item);
        const serverQs = item.serverId ? `?server=${encodeURIComponent(item.serverId)}` : '';
        const itemPath = `${PLAYER_APP_BASE}/item/${encodeURIComponent(item.ratingKey)}`;
        // Destination path — so episode hubs can focus this card when the rail paints.
        if (item.type === 'episode' || item.type === 'season') {
            rememberTvFocusKey(item.ratingKey, itemPath);
        }
        navigate(`${itemPath}${serverQs}`, opts);
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

    const goLiveTv = useCallback(() => {
        navigate(`${PLAYER_APP_BASE}/livetv`);
    }, [navigate]);

    const goDownloads = useCallback(() => {
        navigate(`${PLAYER_APP_BASE}/downloads`);
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

    // Android shell: Assistant / system "search for X" and Watch Next row taps.
    // MainActivity retries until these exist, so they are only set once signed in.
    useEffect(() => {
        const searchFor = (query: string) => {
            requestPlayerSearchQuery(query);
            openSearch();
        };
        const openItem = (ratingKey: string, serverId?: string) => {
            const key = String(ratingKey || '').trim();
            if (!key) return;
            const serverQs = serverId ? `?server=${encodeURIComponent(serverId)}` : '';
            navigate(`${PLAYER_APP_BASE}/item/${encodeURIComponent(key)}${serverQs}`);
        };
        window.__SMP_SEARCH_FOR__ = searchFor;
        window.__SMP_OPEN_ITEM__ = openItem;
        return () => {
            if (window.__SMP_SEARCH_FOR__ === searchFor) delete window.__SMP_SEARCH_FOR__;
            if (window.__SMP_OPEN_ITEM__ === openItem) delete window.__SMP_OPEN_ITEM__;
        };
    }, [navigate, openSearch]);

    useEffect(() => {
        const onNowPlaying = (event: Event) => {
            const detail = (event as CustomEvent<MusicNowPlayingDetail>).detail || null;
            setMusicMinimized(Boolean(detail?.minimized));
        };
        window.addEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
        return () => window.removeEventListener(MUSIC_NOW_PLAYING_EVENT, onNowPlaying);
    }, []);

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

    const openWatchTogether = useCallback((item: PlayerItem) => {
        const ratingKey = String(item.ratingKey || '').trim();
        if (!ratingKey) return;
        const serverId = String(item.serverId || '').trim();
        setWatchTogetherItem(item);
        const qs = new URLSearchParams({ ratingKey });
        if (serverId) qs.set('server', serverId);
        navigate(`${PLAYER_APP_BASE}/watch-together/create?${qs.toString()}`);
    }, [navigate]);

    useEffect(() => {
        if (view.kind !== 'watchTogether' || view.mode !== 'create') return;
        if (watchTogetherItem?.ratingKey === view.ratingKey) return;
        let cancelled = false;
        void fetchMediaPlayerItem(view.ratingKey, { core: true, serverId: view.serverId || null })
            .then((page) => {
                if (!cancelled) setWatchTogetherItem(page.item);
            })
            .catch(() => {
                if (!cancelled) setWatchTogetherItem(null);
            });
        return () => { cancelled = true; };
    }, [view, watchTogetherItem?.ratingKey]);

    const cancelPlayNextBridge = useCallback(() => {
        startPlaybackGenRef.current += 1;
        startingPlayRef.current = false;
        setStartingPlay(false);
        setPlayNextBridge(false);
        autoplayStreakRef.current = 0;
        if (isAndroidTvUi()) {
            window.setTimeout(() => restoreTvFocusWhenReady(), 80);
        }
    }, []);

    const startPlayback = useCallback(async (item: PlayerItem, opts: PlayerPlayOptions = {}) => {
        const current = playSessionRef.current;
        // Music can swap tracks in-place (native updateSrc) while a session is live —
        // including while minimized — so browse → pick another track keeps working.
        const replacingMusic = Boolean(
            current
            && isMusicPlayerItem(current.item)
            && isMusicPlayerItem(item),
        );
        // Play-next bridge: allow start even if the prior session ref briefly lingers.
        if (startingPlayRef.current) return;
        if (current && !replacingMusic && !playNextBridgeRef.current) return;
        const gen = ++startPlaybackGenRef.current;
        startingPlayRef.current = true;
        if (isAndroidTvUi() && !replacingMusic) captureTvFocusSnapshot();
        setStartingPlay(true);
        setPendingResume(null);
        if (!replacingMusic) {
            playNextBridgeRef.current = true;
            setPlayNextBridge(true);
        }
        try {
            const liveTune = item.type === 'liveAiring' || Boolean(item.liveChannelId || item.liveDvrId);
            if (liveTune) {
                let dvrId = String(item.liveDvrId || '').trim();
                let channelId = String(item.liveChannelId || item.liveChannelNumber || '').trim();
                if (!dvrId || !channelId) {
                    const sources = await fetchLiveTvSources().catch(() => null);
                    const source = (sources?.sources || []).find((row) => (
                        !item.serverId || String(row.serverId) === String(item.serverId)
                    )) || sources?.sources?.[0];
                    dvrId = dvrId || String(source?.id || '').trim();
                    const match = (source?.channels || []).find((row) => (
                        row.id === channelId
                        || row.number === channelId
                        || row.number === item.liveChannelNumber
                        || row.title === item.liveChannelTitle
                    ));
                    channelId = channelId || String(match?.id || match?.number || source?.channels?.[0]?.id || '').trim();
                }
                if (!dvrId || !channelId) {
                    throw new Error('No Live TV channel id. Open Live TV again and pick a programme.');
                }
                const session = await tuneLiveTvChannel({
                    serverId: item.serverId,
                    dvrId,
                    channelId,
                    channelNumber: item.liveChannelNumber,
                    title: item.title,
                    item,
                });
                if (gen !== startPlaybackGenRef.current) return;
                setPlaySession(session);
                playNextBridgeRef.current = false;
                setPlayNextBridge(false);
                return;
            }
            const wantOffline = Boolean(
                opts.offlineLocal
                || (isPhoneUi() && isMediaDownloadsSupported() && !opts.watchTogether),
            );
            if (wantOffline && item.ratingKey) {
                const localUrl = await getMediaDownloadLocalUrl({ ratingKey: item.ratingKey }).catch(() => '');
                if (localUrl) {
                    if (gen !== startPlaybackGenRef.current) return;
                    setPlaySession({
                        sessionId: `offline-${item.ratingKey}`,
                        item,
                        src: localUrl,
                        offsetMs: Math.max(0, Number(opts.offsetMs) || 0),
                        qualityId: 'original',
                        canDirectPlay: true,
                        canCopyOriginal: true,
                        playbackMode: 'directPlay',
                        client: 'android',
                        offlineLocal: true,
                    });
                    playNextBridgeRef.current = false;
                    setPlayNextBridge(false);
                    return;
                }
                if (opts.offlineLocal) {
                    throw new Error(t('mediaPlayerPage.downloadMissing'));
                }
            }
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
                // Prefer Direct Play/Stream from the resume offset. Unseekable parts
                // still hop to HLS on scrub via native reason=seek.
            };
            const playRequest = {
                ...baseOpts,
                audioStreamId: opts.audioStreamId !== undefined ? opts.audioStreamId : undefined,
                subtitleStreamId: opts.subtitleStreamId !== undefined ? opts.subtitleStreamId : undefined,
            };
            const prepared = takePreparedMediaPlayerPlayback(item.ratingKey, playRequest);
            let session = prepared
                ? await prepared.catch(() => null)
                : null;
            if (!session) session = await startMediaPlayerPlayback(item.ratingKey, playRequest);
            if (gen !== startPlaybackGenRef.current) return;
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
                    const discarded = playSessionIdFromSrc(session.src) || session.sessionId;
                    if (discarded) {
                        await stopMediaPlayerTranscode(discarded, {
                            serverId: item.serverId,
                            ratingKey: item.ratingKey,
                        }).catch(() => undefined);
                    }
                    if (gen !== startPlaybackGenRef.current) return;
                    session = await startMediaPlayerPlayback(item.ratingKey, {
                        ...baseOpts,
                        audioStreamId: nextAudio,
                        subtitleStreamId: nextSub,
                        sessionId: discarded || undefined,
                    });
                }
            }
            if (gen !== startPlaybackGenRef.current) return;
            setPlaySession(session);
            playNextBridgeRef.current = false;
            setPlayNextBridge(false);
        } catch (error: any) {
            if (gen === startPlaybackGenRef.current) {
                playNextBridgeRef.current = false;
                setPlayNextBridge(false);
                setToasts((prev) => appendToast(prev, String(error?.message || t('mediaPlayerPage.playError')), 'error'));
            }
        } finally {
            if (gen === startPlaybackGenRef.current) {
                startingPlayRef.current = false;
                setStartingPlay(false);
            }
        }
    }, [settings.audioLanguage, settings.defaultQualityId, settings.subtitleMode, t]);

    const startWatchTogetherPlayback = useCallback(async (state: WtRoomState) => {
        const offsetMs = Math.max(0, Number(state.positionMs) || 0);
        const hostKey = String(state.ratingKey || '').trim();
        const client = getWatchTogetherClient();
        const isHost = Boolean(client.localUserId && state.hostUserId && client.localUserId === state.hostUserId);
        try {
            let item: PlayerItem | null = null;
            if (isHost && hostKey) {
                try {
                    const page = await fetchMediaPlayerItem(hostKey, {
                        core: true,
                        serverId: state.serverId || null,
                    });
                    item = page.item;
                } catch {
                    item = watchTogetherItem?.ratingKey === hostKey ? watchTogetherItem : null;
                }
            } else {
                const matched = await resolveWatchTogetherLocalItem({
                    guids: state.guids || [],
                    tmdbId: state.tmdbId ?? null,
                    year: state.year ?? null,
                    title: state.title || '',
                    mediaType: state.mediaType || 'movie',
                }).catch(() => ({ item: null as PlayerItem | null }));
                item = matched?.item || null;
                // Same shared PMS: host ratingKey may still resolve for the joiner.
                if (!item?.ratingKey && hostKey) {
                    try {
                        const page = await fetchMediaPlayerItem(hostKey, {
                            core: true,
                            serverId: state.serverId || null,
                        });
                        item = page.item;
                    } catch {
                        item = null;
                    }
                }
            }
            if (!item?.ratingKey || !(item.canPlay || item.type === 'movie' || item.type === 'episode' || item.type === 'track')) {
                notify(t('mediaPlayerPage.watchTogetherNotInLibrary'), 'error');
                return;
            }
            await startPlayback(item, {
                offsetMs,
                skipResume: true,
            });
            // Mark the room playing so solo-host buffering cannot snap position
            // back to the create offset and force a stream restart.
            client.play(offsetMs);
        } catch {
            notify(t('mediaPlayerPage.watchTogetherNotInLibrary'), 'error');
        }
    }, [notify, startPlayback, t, watchTogetherItem]);

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
            || opts.shuffleUnwatched
            || opts.playFromHere
            || opts.playUnwatchedFromHere
            || item.type === 'show'
            || item.type === 'season'
            || item.type === 'album'
            || item.type === 'artist'
            || item.type === 'track'
        ) && item.ratingKey) {
            try {
                const data = opts.shuffle && !opts.shuffleUnwatched
                    ? await fetchMediaPlayerShuffleQueue(item.ratingKey, item.serverId)
                    : await fetchMediaPlayerPlayFromQueue(item.ratingKey, item.serverId);
                let rows = (data.items || []).filter((row) => row?.ratingKey);
                if (opts.shuffleUnwatched) {
                    rows = shufflePlayerItems(filterQueueUnwatched(rows));
                } else if (!opts.shuffle && (item.type === 'show' || item.type === 'season') && !opts.playFromHere && !opts.playUnwatchedFromHere) {
                    rows = sliceQueueToNextUnwatched(rows);
                }
                if (!opts.shuffle && !opts.shuffleUnwatched && opts.playUnwatchedFromHere) {
                    rows = sliceQueueUnwatchedFromHere(rows);
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
                    shuffleUnwatched: false,
                    playFromHere: false,
                    playUnwatchedFromHere: false,
                    skipResume: opts.shuffle || opts.shuffleUnwatched || opts.playUnwatchedFromHere ? true : opts.skipResume,
                    offsetMs: opts.shuffle || opts.shuffleUnwatched || opts.playUnwatchedFromHere ? 0 : opts.offsetMs,
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
        if (target?.type === 'liveAiring' || (target?.liveChannelId && target?.liveDvrId)) {
            await startPlayback(target, { ...nextOpts, skipResume: true, offsetMs: 0 });
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
        const trailerCount = Math.min(5, Math.max(0, Number(settings.cinemaTrailerCount) || 0));
        if (
            trailerCount > 0
            && target.type === 'movie'
            && fromStart
            && !isPlayerTrailer(target)
            && target.ratingKey
        ) {
            let extras = readPlayerItemCache(target.ratingKey, target.serverId)?.extras || [];
            if (!extras.length) {
                const more = await fetchMediaPlayerItemMore(target.ratingKey, target.serverId).catch(() => null);
                extras = more?.extras || [];
            }
            const trailers = extras.filter((row) => isPlayerTrailer(row) && row.ratingKey).slice(0, trailerCount);
            if (trailers.length) {
                setPlayNextQueue((prev) => [...trailers.slice(1), target, ...prev.filter((row) => row.ratingKey !== target.ratingKey)]);
                target = trailers[0];
                nextOpts = { ...nextOpts, skipResume: true, offsetMs: 0 };
            }
        }
        await startPlayback(target, nextOpts);
    }, [navigate, settings.cinemaTrailerCount, settings.stillWatchingAfter, startPlayback, t]);

    useEffect(() => {
        if (playSession) {
            playNextBridgeRef.current = false;
            setPlayNextBridge(false);
            return undefined;
        }
        if (!isAndroidTvUi()) return undefined;
        const id = window.setTimeout(() => restoreTvFocusWhenReady(), 120);
        return () => window.clearTimeout(id);
    }, [playSession]);

    useEffect(() => {
        const onReturned = () => {
            if (isAndroidTvUi()) {
                window.setTimeout(() => restoreTvFocusWhenReady(), 80);
            }
        };
        window.addEventListener('smp-native-player-returned', onReturned);
        return () => window.removeEventListener('smp-native-player-returned', onReturned);
    }, []);

    // While the play-next black bridge is up, MediaPlayerVideo is unmounted so
    // __SMP_CLOSE_PLAYBACK__ is gone — Back must still cancel the hang.
    useEffect(() => {
        if (!playNextBridge || playSession) return undefined;
        const close = () => {
            cancelPlayNextBridge();
            return true;
        };
        window.__SMP_CLOSE_PLAYBACK__ = close;
        // Never leave a dead black overlay for minutes if /play hangs.
        const safety = window.setTimeout(() => {
            if (!playNextBridgeRef.current || playSessionRef.current) return;
            cancelPlayNextBridge();
            setToasts((prev) => appendToast(
                prev,
                t('mediaPlayerPage.playError') || 'Could not start the next episode.',
                'error',
            ));
        }, 15000);
        return () => {
            window.clearTimeout(safety);
            if (window.__SMP_CLOSE_PLAYBACK__ === close) delete window.__SMP_CLOSE_PLAYBACK__;
        };
    }, [playNextBridge, playSession, cancelPlayNextBridge, t]);

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
            : view.kind === 'livetv'
                ? 'livetv'
            : view.kind === 'downloads'
                ? 'downloads'
            : view.kind === 'playlists' || view.kind === 'playlist'
                ? 'playlists'
            : view.kind === 'settings'
                ? 'settings'
                : view.kind === 'library' || view.kind === 'collection'
                    ? 'library'
                    : 'other';
    const activeLibraryKey = view.kind === 'library' || view.kind === 'collection' ? view.sectionKey : undefined;
    const isItemView = view.kind === 'item';
    const phoneNav = !tvShell && navPage !== 'other';
    const navContentInset = tvShell
        ? (navExpanded ? '18.5rem' : '6.75rem')
        : (navExpanded ? '18.25rem' : '6.5rem');

    return (
        <div className="relative flex h-full min-h-0 w-full flex-col">
            {tvShell && !playSession && !(view.kind === 'library' && view.tab === 'browse') ? <PlayerTvClock /> : null}
            <MediaPlayerNav
                libraries={libraries}
                libraryOrder={settings.libraryNavOrder}
                page={navPage}
                activeLibraryKey={activeLibraryKey}
                expanded={navExpanded}
                onToggleExpanded={toggleNavExpanded}
                onHome={goHome}
                onWatchlist={goWatchlist}
                onLiveTv={hasLiveTv ? goLiveTv : undefined}
                onDownloads={!tvShell && isPhoneUi() && isMediaDownloadsSupported() ? goDownloads : undefined}
                onSearch={openSearch}
                onOpenLibrary={openLibrary}
                onOpenPlaylists={goPlaylists}
                onOpenSettings={openSettings}
                playlistsEnabled={settings.showPlaylists}
                // Don't use navigator.onLine on TV — WebViews lie; per-server status is enough.
                offline={false}
                offlineServerIds={offlineServerIds}
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
                } ${musicMinimized ? 'pb-36' : ''}`}
                style={isItemView ? { '--player-nav-inset': navContentInset } as React.CSSProperties : undefined}
            >
                <div className={`mx-auto flex w-full flex-col ${isItemView ? 'max-w-none gap-0' : 'max-w-[2400px] gap-4'}`}>
            {keepHome ? (
                <div className={view.kind === 'home' ? '' : 'hidden'} hidden={view.kind !== 'home'}>
                    <MediaPlayerHome
                        active={view.kind === 'home'}
                        onOpenItem={(item) => (
                            item.type === 'liveAiring'
                                ? void playItem(item, { skipResume: true })
                                : openItem(item)
                        )}
                        onPlay={playItem}
                        onOpenLibrary={openLibrary}
                        onOpenHub={openHub}
                        onOpenWatchlist={goWatchlist}
                        onOpenLiveTv={hasLiveTv ? goLiveTv : undefined}
                        onPlayNext={enqueuePlayNext}
                        onToast={notify}
                        isAdmin={isAdmin}
                        playlistsEnabled={settings.showPlaylists}
                    />
                </div>
            ) : null}
            {view.kind === 'livetv' ? (
                <div key="livetv" className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <PlayerLiveTv
                        onBack={goHome}
                        onPlay={playItem}
                        onToast={notify}
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
            {view.kind === 'downloads' ? (
                <div key="downloads" className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <MediaPlayerDownloads
                        onBack={goHome}
                        onPlay={playItem}
                        onToast={notify}
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
                    onOpenStudio={openStudio}
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
                    onOpenItem={openItem}
                    onPlay={playItem}
                    onPlayNext={enqueuePlayNext}
                    onToast={notify}
                    isAdmin={isAdmin}
                    playlistsEnabled={settings.showPlaylists}
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
                // No whole-screen fade on TV: fading the page in from black is what made
                // title pages start black. The backdrop and its gradient should just be there.
                <div key={viewScreenMotionKey(view)} className={tvShell ? '' : screenEnterClass(tvShell, tvScreenEnter)}>
                <MediaPlayerDetails
                    ratingKey={view.ratingKey}
                    serverId={view.serverId}
                    onBack={goBack}
                    onOpenItem={openItem}
                    onOpenPerson={openPerson}
                    onOpenStudio={openStudio}
                    onPlay={playItem}
                    onPlayNext={enqueuePlayNext}
                    onWatchTogether={openWatchTogether}
                    onToast={notify}
                    isAdmin={isAdmin}
                    playlistsEnabled={settings.showPlaylists}
                    playing={startingPlay}
                    playbackActive={Boolean(playSession)}
                />
                </div>
            ) : null}
            {view.kind === 'watchTogether' ? (
                <div key={viewScreenMotionKey(view)} className={screenEnterClass(tvShell, tvScreenEnter)}>
                    <WatchTogetherLobby
                        mode={view.mode}
                        item={view.mode === 'create' ? watchTogetherItem : null}
                        inviteCode={view.mode === 'join' ? view.inviteCode : undefined}
                        onBack={() => {
                            discardWatchTogetherClient();
                            goBack();
                        }}
                        onStart={(state) => { void startWatchTogetherPlayback(state); }}
                        onToast={notify}
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
                    watchTogether={Boolean(getWatchTogetherClient().state?.inviteCode)}
                    onClose={(meta) => {
                        const chaining = !!meta?.playNext;
                        if (chaining) {
                            playNextBridgeRef.current = true;
                            setPlayNextBridge(true);
                            setPlaySession(null);
                            return;
                        }
                        playNextBridgeRef.current = false;
                        setPlayNextBridge(false);
                        setPlaySession(null);
                        if (getWatchTogetherClient().state?.inviteCode) {
                            discardWatchTogetherClient();
                        }
                        // Stay on the screen that started playback (Home, library, details, …).
                        // Forcing openItem() pushed a duplicate /item URL so the next Back
                        // looked like a no-op and fell through to the last library.
                    }}
                    onPlaybackError={(message) => notify(message, 'error')}
                    autoplayNext={settings.autoplayNext}
                    autoSkipIntro={settings.skipIntroMode === 'auto' || settings.autoSkipIntro}
                    autoSkipCredits={settings.skipCreditsMode === 'auto' || settings.autoSkipCredits}
                    playNextQueue={playNextQueue}
                    onConsumePlayNext={consumePlayNext}
                    onPlayItem={playItem}
                />
            ) : null}
            {playNextBridge && !playSession ? (
                <div
                    className="fixed inset-0 z-[4000] flex items-center justify-center bg-black"
                    aria-hidden
                    data-tv-playback-overlay="1"
                >
                    <div className="pointer-events-none flex flex-col items-center gap-4">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
                        <p className="text-sm font-semibold text-white/80">{t('mediaPlayerPage.loadingNextEpisode')}</p>
                    </div>
                </div>
            ) : null}
            {/* Global TV music dock — visible on home, library, details, search, etc. */}
            {tvShell ? <MediaPlayerNowPlayingChip /> : null}
            <ToastContainer toasts={toasts} setToasts={setToasts} />
                </div>
            </div>
        </div>
    );
};
