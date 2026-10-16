import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DiscoverHeroHeader } from './DiscoverHeroHeader';
import { DiscoverHome } from './DiscoverHome';
import { DiscoverMovies } from './DiscoverMovies';
import { DiscoverSeries } from './DiscoverSeries';
import { DiscoverCategoryPage } from './DiscoverCategoryPage';
import { DiscoverRailPage } from './DiscoverRailPage';
import { MediaDetailsPage } from './MediaDetailsPage';
import { PersonDetailsPage } from './PersonDetailsPage';
import { Film, Tv, Compass, ClipboardList, AlertTriangle, ChevronDown, Music, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { portalUrl, stripBasePath } from '../shared/basePath';
import { getDiscoverItemKey, normalizeRawDiscoveryItem } from './discoverItemUtils';
import { resolveMediaAvailabilityState } from './discoverAvailability';
import { enrichDiscoverBrowseRows } from './discoverAvailabilityEnrich';
import { DiscoverStatusOverlay } from './DiscoverStatusOverlay';
import { MyRequestsPage } from './MyRequestsPage';
import { MyIssuesPage } from './MyIssuesPage';
import { useMyRequestCount } from './useMyRequestCount';
import { useMyIssueCount } from './useMyIssueCount';
import { useDiscoveryMe } from './useDiscoveryMe';
import { WatchlistPage } from './WatchlistPage';
import { DiscoverMusic } from './DiscoverMusic';
import { MusicArtistPage } from './MusicArtistPage';
import { RequestQueueDashboard } from '../requests/RequestQueueDashboard';
import {
    currentDiscoverPathWithSearch,
    consumeDiscoverPersonReturn,
    readDiscoverBrowsePath,
    restoreDiscoverScrollPositionWhenReady,
    stashDiscoverBrowsePath,
    stashDiscoverDetailSeed,
    stashDiscoverPersonReturn,
    stashDiscoverScrollPosition,
} from './discoverNavigationUtils';
import { resolveTmdbImageUrl } from './tmdbImageUrl';
import { useDiscoverI18n } from './i18n';
import { discoveryTheme } from './discoveryThemeClasses';
import { ToastContainer, pushToast as appendToast, type ToastMessage } from '../shared/toast';

const DISCOVER_HIDDEN_KEYS_STORAGE_KEY = 'discover:hiddenKeys:v1';

const readHiddenDiscoverKeys = () => {
    if (typeof localStorage === 'undefined') return new Set<string>();
    try {
        const raw = localStorage.getItem(DISCOVER_HIDDEN_KEYS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return new Set<string>();
        return new Set(parsed.map((value) => String(value || '').trim()).filter(Boolean));
    } catch {
        return new Set<string>();
    }
};

const writeHiddenDiscoverKeys = (keys: Set<string>) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(DISCOVER_HIDDEN_KEYS_STORAGE_KEY, JSON.stringify(Array.from(keys)));
    } catch {
        // ignore storage errors
    }
};

const readDiscoverSearchQuery = () => {
    if (typeof window === 'undefined') return '';
    try {
        return String(new URLSearchParams(window.location.search).get('q') || '').trim();
    } catch {
        return '';
    }
};

type DiscoverQuickAction = {
    id: string;
    label: string;
    tone?: 'default' | 'danger';
    onClick: () => void | Promise<void>;
};

const DiscoveryDashboardInner: React.FC<{
    onItemClick: (item: any) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    mediaServerType?: string;
    isAdmin?: boolean;
    showReviewQueue?: boolean;
    queueBadgeCount?: number;
    openIssueCount?: number;
    onQueueCountsChange?: () => void;
}> = ({
    pushToast,
    mediaServerType = 'plex',
    isAdmin = false,
    showReviewQueue = false,
    queueBadgeCount = 0,
    openIssueCount = 0,
    onQueueCountsChange,
}) => {
    const { t, locale } = useDiscoverI18n();
    const [path, setPath] = useState(() => {
        if (typeof window !== 'undefined') return window.location.pathname;
        return '/discovery';
    });

    const [query, setQuery] = useState(readDiscoverSearchQuery);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [searchOpen, setSearchOpen] = useState(() => readDiscoverSearchQuery().length >= 2);
    const [searchRetryToken, setSearchRetryToken] = useState(0);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const searchAbortRef = useRef<AbortController | null>(null);
    const searchSeqRef = useRef(0);
    const { pendingCount: myPendingCount, refresh: refreshMyRequestCount } = useMyRequestCount(true);
    const { openCount: myOpenIssueCount, refresh: refreshMyIssueCount } = useMyIssueCount(true);
    const { profile: discoveryMe } = useDiscoveryMe(true);
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const [hiddenDiscoverKeys, setHiddenDiscoverKeys] = useState<Set<string>>(() => readHiddenDiscoverKeys());
    const providerLabel = String(mediaServerType || 'plex').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || 'plex').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';

    const applyDiscoverSearchFromLocation = useCallback(() => {
        const q = readDiscoverSearchQuery();
        if (q.length >= 2) {
            setQuery(q);
            setSearchOpen(true);
        }
    }, []);

    const refreshPath = useCallback(() => {
        setPath(window.location.pathname);
        applyDiscoverSearchFromLocation();
    }, [applyDiscoverSearchFromLocation]);

    useEffect(() => {
        const handlePopState = () => refreshPath();
        window.addEventListener('popstate', handlePopState);
        window.addEventListener('portal-discovery-navigate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('portal-discovery-navigate', handlePopState);
        };
    }, [refreshPath]);

    const stopScrollRestoreRef = useRef<(() => void) | null>(null);
    const startScrollRestore = useCallback((
        restorePath = currentDiscoverPathWithSearch(),
        options?: { fallbackToTop?: boolean },
    ) => {
        stopScrollRestoreRef.current?.();
        stopScrollRestoreRef.current = restoreDiscoverScrollPositionWhenReady(restorePath, options);
    }, []);

    useEffect(() => {
        const fullPath = currentDiscoverPathWithSearch();
        stashDiscoverBrowsePath(fullPath);
        startScrollRestore(fullPath);
        return () => {
            stopScrollRestoreRef.current?.();
            stopScrollRestoreRef.current = null;
        };
    }, [path, startScrollRestore]);

    const navigate = useCallback((newPath: string) => {
        const currentPath = currentDiscoverPathWithSearch();
        stashDiscoverScrollPosition(currentPath);
        stashDiscoverBrowsePath(currentPath);
        const [pathname, ...rest] = newPath.split('?');
        const search = rest.length ? `?${rest.join('?')}` : '';
        stashDiscoverPersonReturn(currentPath, `${pathname}${search}`);
        const target = `${portalUrl(pathname)}${search}`;
        window.history.pushState({}, '', target);
        setPath(window.location.pathname);
        const seeded = String(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('q') || '').trim();
        if (seeded.length >= 2) {
            setQuery(seeded);
            setSearchOpen(true);
        } else {
            setSearchOpen(false);
        }
        window.dispatchEvent(new Event('portal-discovery-navigate'));
    }, []);

    const canSeeReviewQueueTab = Boolean(isAdmin && showReviewQueue);

    useEffect(() => {
        const normalized = stripBasePath(typeof window !== 'undefined' ? window.location.pathname : path);
        const parts = normalized.split('/').filter(Boolean);
        const currentSub = parts[1] || 'home';
        if (currentSub === 'queue' && !canSeeReviewQueueTab) {
            navigate('/discovery');
        }
    }, [canSeeReviewQueueTab, navigate, path]);

    const persistHiddenDiscoverKeys = useCallback((next: Set<string>) => {
        setHiddenDiscoverKeys(next);
        writeHiddenDiscoverKeys(next);
    }, []);

    const toggleHiddenDiscoverItem = useCallback((item: any) => {
        const key = String(item?.discoverKey || getDiscoverItemKey(item) || '').trim();
        if (!key) return false;
        const next = new Set(hiddenDiscoverKeys);
        const hidden = next.has(key);
        if (hidden) next.delete(key);
        else next.add(key);
        persistHiddenDiscoverKeys(next);
        pushToast?.(
            hidden ? t('quickActions.unhidden') : t('quickActions.hidden'),
            'success',
        );
        return !hidden;
    }, [hiddenDiscoverKeys, persistHiddenDiscoverKeys, pushToast, t]);

    const quickNotifyToggle = useCallback(async (item: any) => {
        const mediaType = item?.mediaType === 'tv'
            ? 'tv'
            : item?.mediaType === 'music'
                ? 'music'
                : 'movie';
        const mediaId = mediaType === 'music'
            ? String(item?.mbid || item?.id || '').trim()
            : Number(item?.id || item?.tmdbId || 0);
        if ((mediaType === 'music' && !mediaId) || (mediaType !== 'music' && (!Number.isFinite(mediaId) || mediaId <= 0))) {
            pushToast?.(t('quickActions.notifyBlocked'), 'error');
            return;
        }
        try {
            const params = new URLSearchParams({
                mediaType,
                mediaId: String(mediaId),
            });
            const options = await apiFetch(`/api/discovery/request-options?${params.toString()}`);
            const watching = !!options?.isWatching;
            if (!watching && !options?.canNotify) {
                pushToast?.(String(options?.blockReason || t('quickActions.notifyBlocked')), 'error');
                return;
            }
            await apiFetch('/api/discovery/request/notify', {
                method: 'POST',
                body: JSON.stringify({
                    mediaType,
                    mediaId,
                    subscribe: !watching,
                }),
            });
            pushToast?.(watching ? t('quickActions.notifyOff') : t('quickActions.notifyOn'), 'success');
        } catch (error: any) {
            pushToast?.(String(error?.message || t('quickActions.notifyBlocked')), 'error');
        }
    }, [pushToast, t]);

    const openQuickRequest = useCallback((item: any) => {
        const mediaType = item?.mediaType === 'tv'
            ? 'tv'
            : item?.mediaType === 'movie'
                ? 'movie'
                : item?.type === 'tv'
                    ? 'tv'
                    : item?.type === 'movie'
                        ? 'movie'
                        : null;
        if (mediaType) {
            const mediaId = Number(item?.id || item?.tmdbId || 0);
            if (Number.isFinite(mediaId) && mediaId > 0) {
                const here = currentDiscoverPathWithSearch();
                stashDiscoverScrollPosition(here);
                stashDiscoverBrowsePath(here);
                stashDiscoverDetailSeed(item);
                navigate(`/discovery/${mediaType}/${mediaId}?request=1`);
                return;
            }
        }
        if (item?.mediaType === 'music' || item?.type === 'music') {
            const mbid = String(item?.mbid || item?.id || '').trim();
            if (mbid) {
                const here = currentDiscoverPathWithSearch();
                stashDiscoverScrollPosition(here);
                stashDiscoverBrowsePath(here);
                navigate(`/discovery/music/artist/${encodeURIComponent(mbid)}`);
                pushToast?.(t('quickActions.requestHint'), 'success');
            }
        }
    }, [navigate, pushToast, t]);

    const getQuickActions = useCallback((item: any): DiscoverQuickAction[] => {
        const actions: DiscoverQuickAction[] = [];
        if (item?.mediaType !== 'person') {
            actions.push({
                id: 'request',
                label: t('quickActions.request'),
                onClick: () => openQuickRequest(item),
            });
            actions.push({
                id: 'notify',
                label: t('quickActions.notify'),
                onClick: () => quickNotifyToggle(item),
            });
        }
        const plexUrl = String(item?.plexUrl || '').trim();
        if (plexUrl && plexUrl !== '#') {
            actions.push({
                id: 'plex',
                label: t('quickActions.openInPlex'),
                onClick: () => window.open(plexUrl, '_blank', 'noopener,noreferrer'),
            });
        }
        if (item?.discoverKey) {
            const hidden = hiddenDiscoverKeys.has(String(item.discoverKey));
            actions.push({
                id: 'hide',
                label: hidden ? t('quickActions.unhide') : t('quickActions.hide'),
                tone: hidden ? 'default' : 'danger',
                onClick: () => toggleHiddenDiscoverItem(item),
            });
        }
        return actions;
    }, [hiddenDiscoverKeys, openQuickRequest, quickNotifyToggle, t, toggleHiddenDiscoverItem]);

    const navigateBackToBrowse = useCallback((fallback = '/discovery') => {
        const stored = readDiscoverBrowsePath();
        if (stored) {
            navigate(stored);
            return;
        }
        navigate(fallback);
    }, [navigate]);

    const resetHiddenDiscoverItems = useCallback(() => {
        persistHiddenDiscoverKeys(new Set());
        pushToast?.(t('quickActions.resetDone'), 'success');
    }, [persistHiddenDiscoverKeys, pushToast, t]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            event.preventDefault();
            stashDiscoverScrollPosition();
            searchInputRef.current?.focus({ preventScroll: true });
            searchInputRef.current?.select();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            searchAbortRef.current?.abort();
            searchAbortRef.current = null;
            setSearchResults([]);
            setSearchError(null);
            setSearchLoading(false);
            return undefined;
        }

        const timer = window.setTimeout(async () => {
            searchAbortRef.current?.abort();
            const controller = new AbortController();
            searchAbortRef.current = controller;
            const seq = ++searchSeqRef.current;
            let timedOut = false;
            // Hard cap so a hung API never leaves the hero stuck on "Searching…"
            const timeoutId = window.setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, 12000);

            setSearchLoading(true);
            setSearchError(null);
            setSearchOpen(true);

            try {
                const res = await apiFetch(
                    `/api/discovery/search?query=${encodeURIComponent(q)}`,
                    { signal: controller.signal },
                );
                if (seq !== searchSeqRef.current) return;
                const rawResults = Array.isArray(res?.results) ? res.results : [];
                setSearchResults(rawResults);
                setSearchError(null);
                void enrichDiscoverBrowseRows(rawResults).then((enriched) => {
                    if (seq !== searchSeqRef.current) return;
                    setSearchResults(enriched);
                }).catch(() => {});
            } catch (e: any) {
                if (seq !== searchSeqRef.current) return;
                const aborted = controller.signal.aborted
                    || e?.name === 'AbortError'
                    || /aborted/i.test(String(e?.message || ''));
                if (aborted && !timedOut) return; // superseded by a newer query
                console.error(e);
                setSearchResults([]);
                setSearchError(e?.message || t('common.searchFailed'));
            } finally {
                window.clearTimeout(timeoutId);
                if (seq === searchSeqRef.current) setSearchLoading(false);
            }
        }, 300);

        return () => {
            window.clearTimeout(timer);
        };
    }, [query, locale, searchRetryToken, t]);

    const formatItem = useCallback((rawItem: any) => {
        const item = normalizeRawDiscoveryItem(rawItem);
        const isPerson = item.mediaType === 'person';
        const isMusic = item.mediaType === 'music';
        const isMovie = item.mediaType === 'movie';
        const title = isPerson ? item.name : (isMovie ? (item.title || item.name) : (item.name || item.title));
        const year = (item.releaseDate || item.firstAirDate || '').substring(0, 4);
        const posterUrl = isMusic
            ? (item.posterPath || item.posterUrl || null)
            : resolveTmdbImageUrl(item.posterPath, 'w342');
        const profileUrl = resolveTmdbImageUrl(item.profilePath, 'w185');
        const overview = item.overview;
        const mediaType = isPerson ? 'person' : (isMusic ? 'music' : (isMovie ? 'movie' : 'tv'));

        const availability = resolveMediaAvailabilityState(item);
        const discoverKey = getDiscoverItemKey(item);
        const hidden = discoverKey ? hiddenDiscoverKeys.has(discoverKey) : false;
        const overlay = !isPerson && availability.kind !== 'none'
            ? <DiscoverStatusOverlay state={availability} />
            : null;

        return {
            ...item,
            id: item.tmdbId || item.mbid || item.id,
            mediaType,
            title,
            year,
            thumbUrl: isPerson ? profileUrl : (posterUrl || null),
            overview,
            type: mediaType,
            tags: [isPerson ? t('mediaType.person') : (isMusic ? t('mediaType.music') : (isMovie ? t('mediaType.movie') : t('mediaType.tvShow')))],
            status: item.mediaInfo?.status,
            availability,
            isAvailable: availability.kind === 'available',
            isPartial: availability.kind === 'partial',
            isPending: availability.kind === 'pending' || availability.kind === 'processing',
            overlay,
            discoverKey,
            hidden,
        };
    }, [hiddenDiscoverKeys, t]);

    const heroProps = {
        query,
        searchOpen,
        searchLoading,
        searchError,
        searchResults,
        onClose: () => {
            setSearchOpen(false);
            startScrollRestore(currentDiscoverPathWithSearch(), { fallbackToTop: false });
        },
        onClear: () => {
            searchAbortRef.current?.abort();
            setQuery('');
            setSearchOpen(false);
            setSearchResults([]);
            setSearchError(null);
            try {
                const url = new URL(window.location.href);
                if (url.searchParams.has('q')) {
                    url.searchParams.delete('q');
                    const nextSearch = url.searchParams.toString();
                    window.history.replaceState({}, '', `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`);
                }
            } catch {
                /* ignore */
            }
            startScrollRestore(currentDiscoverPathWithSearch(), { fallbackToTop: false });
        },
        onQueryChange: setQuery,
        onFocus: () => {
            stashDiscoverScrollPosition();
            if (query.trim().length >= 2) setSearchOpen(true);
        },
        onRetrySearch: () => setSearchRetryToken((n) => n + 1),
        formatItem,
        navigate,
        searchInputRef,
        onSelect: (formatted: any) => {
            if (formatted.type === 'person') {
                navigate(`/discovery/person/${formatted.id}`);
            } else if (formatted.type === 'music' || formatted.mediaType === 'music') {
                navigate(`/discovery/music/artist/${encodeURIComponent(String(formatted.mbid || formatted.id))}`);
            } else {
                stashDiscoverDetailSeed(formatted);
                navigate(`/discovery/${formatted.type}/${formatted.id}`);
            }
        },
    };

    const openMedia = useCallback((item: any) => {
        if (item.type === 'music' || item.mediaType === 'music') {
            const mbid = item.mbid || item.id;
            navigate(`/discovery/music/artist/${encodeURIComponent(String(mbid))}`);
            return;
        }
        stashDiscoverDetailSeed(item);
        navigate(`/discovery/${item.type}/${item.id}`);
    }, [navigate]);

    const routeParts = stripBasePath(path).split('/').filter(Boolean);
    const subRoute = routeParts[1] || 'home';

    if (routeParts.length >= 3 && routeParts[1] === 'row' && routeParts[2]) {
        return (
            <div className="discovery-theme w-full flex flex-col gap-4 pb-8">
                <DiscoverRailPage
                    slug={routeParts[2]}
                    onBack={() => navigate('/discovery')}
                    onSelect={openMedia}
                    formatItem={formatItem}
                    navigate={navigate}
                    getQuickActions={getQuickActions}
                />
            </div>
        );
    }

    if (routeParts.length >= 4 && routeParts[1] === 'movies' && routeParts[2] === 'studio') {
        const id = parseInt(routeParts[3], 10);
        if (!Number.isNaN(id)) {
            return (
                <DiscoverCategoryPage
                    kind="studio"
                    id={id}
                    onBack={() => navigate('/discovery')}
                    onSelect={openMedia}
                    formatItem={formatItem}
                />
            );
        }
    }

    if (routeParts.length >= 4 && routeParts[1] === 'series' && routeParts[2] === 'network') {
        const id = parseInt(routeParts[3], 10);
        if (!Number.isNaN(id)) {
            return (
                <DiscoverCategoryPage
                    kind="network"
                    id={id}
                    onBack={() => navigate('/discovery')}
                    onSelect={openMedia}
                    formatItem={formatItem}
                />
            );
        }
    }

    if (routeParts.length >= 3 && routeParts[1] === 'person') {
        const id = parseInt(routeParts[2], 10);
        return (
            <PersonDetailsPage
                personId={id}
                onBack={() => {
                    const from = consumeDiscoverPersonReturn(id);
                    if (!from) {
                        navigateBackToBrowse('/discovery');
                        return;
                    }
                    const stillOnThisPerson = () => {
                        const parts = stripBasePath(window.location.pathname).split('/').filter(Boolean);
                        return parts[1] === 'person' && Number(parts[2]) === id;
                    };
                    window.history.back();
                    window.setTimeout(() => {
                        if (stillOnThisPerson()) navigate(from);
                    }, 50);
                }}
                onSelect={openMedia}
                formatItem={formatItem}
            />
        );
    }

    if (routeParts.length >= 4 && routeParts[1] === 'music' && routeParts[2] === 'artist') {
        const mbid = decodeURIComponent(routeParts[3] || '');
        return (
            <div className="discovery-theme w-full flex flex-col gap-4 pb-8">
                <DiscoverHeroHeader {...heroProps} />
                <MusicArtistPage
                    mbid={mbid}
                    onBack={() => navigateBackToBrowse('/discovery/music')}
                    pushToast={pushToast}
                    isAdmin={isAdmin}
                />
            </div>
        );
    }

    if (routeParts.length >= 3 && (routeParts[1] === 'movie' || routeParts[1] === 'tv')) {
        const type = routeParts[1] as 'movie' | 'tv';
        const id = parseInt(routeParts[2], 10);
        return (
            <MediaDetailsPage
                mediaType={type}
                mediaId={id}
                onBack={() => navigateBackToBrowse('/discovery')}
                formatItem={formatItem}
                pushToast={pushToast}
                isAdmin={isAdmin}
                mediaServerType={mediaServerType}
            />
        );
    }

    const showTabs = ['home', 'movies', 'series', 'music', 'requests', 'issues', 'queue'].includes(subRoute);

    if (subRoute === 'watchlist') {
        return (
            <div className="discovery-theme w-full flex flex-col gap-4 pb-8">
                <DiscoverHeroHeader {...heroProps} />
                <WatchlistPage
                    formatItem={formatItem}
                    onSelect={openMedia}
                    navigate={navigate}
                    pushToast={pushToast}
                    providerLabel={providerLabel}
                />
            </div>
        );
    }

    const canSeeIssuesTab = Boolean(
        discoveryMe?.permissions?.createIssues || discoveryMe?.permissions?.viewIssues
    );

    const tabs = [
        { id: 'home', path: '/discovery', label: t('nav.discover'), icon: Compass, count: 0, countColor: '' },
        { id: 'movies', path: '/discovery/movies', label: t('nav.movies'), icon: Film, count: 0, countColor: '' },
        { id: 'series', path: '/discovery/series', label: t('nav.series'), icon: Tv, count: 0, countColor: '' },
        { id: 'music', path: '/discovery/music', label: t('nav.music'), icon: Music, count: 0, countColor: '' },
        { id: 'requests', path: '/discovery/requests', label: t('nav.myRequests'), icon: ClipboardList, count: myPendingCount, countColor: 'bg-plex/25 text-plex' },
        ...(canSeeIssuesTab
            ? [{ id: 'issues', path: '/discovery/issues', label: t('nav.myIssues'), icon: AlertTriangle, count: myOpenIssueCount, countColor: 'bg-amber-500/25 text-amber-300' }]
            : []),
        ...(canSeeReviewQueueTab
            ? [{ id: 'queue', path: '/discovery/queue', label: t('nav.reviewQueue'), icon: ShieldCheck, count: queueBadgeCount, countColor: 'bg-amber-500/25 text-amber-200' }]
            : []),
    ];

    const activeTab = tabs.find(t => t.id === subRoute) || tabs[0];
    const ActiveIcon = activeTab.icon;

    const renderTabBadge = (tab: typeof tabs[number], active: boolean) => {
        if (!tab.count) return null;
        return (
            <span className={`min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-black inline-flex items-center justify-center ${
                active ? (tab.countColor || 'bg-plex/25 text-plex') : 'bg-plex text-background'
            }`}>
                {tab.count > 99 ? '99+' : tab.count}
            </span>
        );
    };

    return (
        <div className="discovery-theme w-full flex flex-col gap-2 pb-8">
            <DiscoverHeroHeader {...heroProps} />

            {showTabs && (
                <>
                    {isMobileNavOpen && (
                        <button
                            type="button"
                            className={discoveryTheme.mobileNavBackdrop}
                            aria-label="Close navigation"
                            onClick={() => setIsMobileNavOpen(false)}
                        />
                    )}
                    <div className={`w-full ${discoveryTheme.tabSticky}`}>
                        <div className="sm:hidden relative">
                            <button
                                type="button"
                                onClick={() => setIsMobileNavOpen(!isMobileNavOpen)}
                                className={discoveryTheme.mobileNavBtn}
                                aria-expanded={isMobileNavOpen}
                                aria-controls="discover-mobile-nav-menu"
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    <ActiveIcon className="w-5 h-5 shrink-0" />
                                    <span className="truncate">{activeTab.label}</span>
                                    {renderTabBadge(activeTab, true)}
                                </span>
                                <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${isMobileNavOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isMobileNavOpen && (
                                <div id="discover-mobile-nav-menu" className={discoveryTheme.mobileNavMenu} role="menu">
                                    {tabs.map(tab => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="menuitem"
                                            onClick={() => { navigate(tab.path); setIsMobileNavOpen(false); }}
                                            className={`${discoveryTheme.mobileNavItem} ${tab.id === subRoute ? discoveryTheme.mobileNavItemActive : ''}`}
                                        >
                                            <tab.icon className="w-5 h-5" /> {tab.label}
                                            {tab.count > 0 && (
                                                <span className="ml-auto min-w-[1.25rem] h-5 px-1.5 rounded-full bg-plex text-black text-[10px] font-black inline-flex items-center justify-center">
                                                    {tab.count > 99 ? '99+' : tab.count}
                                                </span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className={`hidden sm:flex ${discoveryTheme.tabBar} items-center gap-2`}>
                            <div className="flex flex-1 min-w-0 gap-1 overflow-x-auto">
                            {tabs.map(tab => {
                                const active = tab.id === subRoute;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => navigate(tab.path)}
                                        className={`${discoveryTheme.tab} ${active ? discoveryTheme.tabActive : ''}`}
                                    >
                                        <tab.icon className="w-4 h-4" />
                                        {tab.label}
                                        {renderTabBadge(tab, active)}
                                    </button>
                                );
                            })}
                            </div>
                        </div>
                    </div>

                    {hiddenDiscoverKeys.size > 0 && (
                        <div className="w-full mt-3 flex justify-end">
                            <button
                                type="button"
                                onClick={resetHiddenDiscoverItems}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-white/5 hover:bg-white/10 text-xs font-bold text-muted hover:text-text transition-colors"
                            >
                                {t('quickActions.resetHidden', { count: hiddenDiscoverKeys.size })}
                            </button>
                        </div>
                    )}

                    <div className="w-full mt-1">
                        {subRoute === 'home' && (
                    <DiscoverHome
                        onSelect={openMedia}
                        formatItem={formatItem}
                        navigate={navigate}
                        pushToast={pushToast}
                        providerLabel={providerLabel}
                        getQuickActions={getQuickActions}
                    />
                        )}
                        {subRoute === 'movies' && (
                            <DiscoverMovies
                                onSelect={openMedia}
                                formatItem={formatItem}
                                navigate={navigate}
                                getQuickActions={getQuickActions}
                            />
                        )}
                        {subRoute === 'series' && (
                            <DiscoverSeries
                                onSelect={openMedia}
                                formatItem={formatItem}
                                navigate={navigate}
                                getQuickActions={getQuickActions}
                            />
                        )}
                        {subRoute === 'music' && (
                            <DiscoverMusic
                                navigate={navigate}
                                formatItem={formatItem}
                                onSelect={openMedia}
                            />
                        )}
                        {subRoute === 'requests' && (
                            <MyRequestsPage
                                navigate={navigate}
                                pushToast={pushToast}
                                onCountsChange={refreshMyRequestCount}
                            />
                        )}
                        {subRoute === 'issues' && (
                            <MyIssuesPage
                                navigate={navigate}
                                pushToast={pushToast}
                                onCountsChange={refreshMyIssueCount}
                            />
                        )}
                        {subRoute === 'queue' && canSeeReviewQueueTab && (
                            <RequestQueueDashboard
                                embedded
                                onCountsChange={onQueueCountsChange}
                                openIssueCount={openIssueCount}
                                navigate={navigate}
                            />
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export const DiscoveryDashboard: React.FC<{
    onItemClick: (item: any) => void;
    pushToast?: (msg: string, type: 'success' | 'error') => void;
    mediaServerType?: string;
    isAdmin?: boolean;
    showReviewQueue?: boolean;
    queueBadgeCount?: number;
    openIssueCount?: number;
    onQueueCountsChange?: () => void;
}> = ({ pushToast: pushToastProp, ...props }) => {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const pushToast = useCallback((msg: string, type: 'success' | 'error') => {
        setToasts((prev) => appendToast(prev, msg, type));
        pushToastProp?.(msg, type);
    }, [pushToastProp]);

    return (
        <>
            <DiscoveryDashboardInner {...props} pushToast={pushToast} />
            <ToastContainer toasts={toasts} setToasts={setToasts} />
        </>
    );
};
