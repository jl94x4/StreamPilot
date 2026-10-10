import React, { useCallback, useEffect, useState } from 'react';
import {
    ChevronRight,
    Film,
    Bookmark,
    Home,
    ListMusic,
    LogOut,
    Menu,
    Music,
    Search,
    Settings,
    Tv,
    User,
    X,
} from 'lucide-react';
import {
    apiFetch,
    exitToPortal,
    lockBackgroundScroll,
    logoutMediaPlayer,
    portalUrl,
    PlexHomeSwitchModal,
    useDiscoverI18n,
    type PlexHomeProfile,
} from './host';
import { fetchMediaPlayerMe } from './api';
import { applyLibraryNavOrder, PLAYER_SETTINGS_DRAFT_EVENT, PLAYER_SETTINGS_EVENT } from './playerSettings';
import { clearHeroSlidesCache, clearPlayerLibrariesCache, invalidatePlayerHomeCache } from './playerMemory';
import { PLAYER_TV_NAV_EVENT } from './paths';
import type { PlayerProfile, PlayerSection } from './types';
import { focusTvContent } from '../plex-client/useTvRemote';

type NavPage = 'home' | 'watchlist' | 'playlists' | 'library' | 'settings' | 'other';

type Props = {
    libraries: PlayerSection[];
    libraryOrder: string[];
    page: NavPage;
    activeLibraryKey?: string;
    expanded: boolean;
    onToggleExpanded: () => void;
    onHome: () => void;
    onWatchlist: () => void;
    onSearch: () => void;
    onOpenLibrary: (section: PlayerSection) => void;
    onOpenPlaylists?: () => void;
    onOpenSettings: () => void;
    playlistsEnabled?: boolean;
    offline?: boolean;
};

const libraryIcon = (type: string) => {
    if (type === 'show') return Tv;
    if (type === 'artist') return Music;
    return Film;
};

const NavAvatar: React.FC<{ profile: PlayerProfile | null; sizeClass: string }> = ({ profile, sizeClass }) => {
    const [failed, setFailed] = useState(false);
    const src = profile?.thumb && !failed ? portalUrl(profile.thumb) : '';
    const initial = String(profile?.username || '?').trim().charAt(0).toUpperCase() || '?';
    if (src) {
        return (
            <img
                src={src}
                alt=""
                className={`${sizeClass} shrink-0 rounded-full object-cover bg-white/10 ring-1 ring-white/20`}
                onError={() => setFailed(true)}
            />
        );
    }
    return (
        <span className={`inline-flex ${sizeClass} shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-black text-white ring-1 ring-white/20`}>
            {profile?.username ? initial : <User className="h-4 w-4" />}
        </span>
    );
};

const navButtonClass = (active: boolean, expanded: boolean, tv = false) => (
    `flex items-center text-left text-sm font-semibold transition-colors ${
        expanded
            ? 'w-full gap-3 rounded-full px-3.5 py-2.5'
            : 'h-9 w-9 justify-center rounded-full'
    } ${
        active && expanded && !tv
            ? 'bg-white text-zinc-900 shadow-lg shadow-black/25'
            : 'text-white/80 hover:bg-white/10 hover:text-white'
    }`
);

const tvNavProps = (isTvShell: boolean, expanded: boolean, active = false) => ({
    'data-tv-item': '1' as const,
    'data-tv-nav': '1' as const,
    ...(active ? { 'data-tv-nav-active': '1' as const } : {}),
    tabIndex: isTvShell && !expanded ? -1 : 0,
});

export const MediaPlayerNav = React.memo(function MediaPlayerNav({
    libraries,
    libraryOrder,
    page,
    activeLibraryKey,
    expanded,
    onToggleExpanded,
    onHome,
    onWatchlist,
    onSearch,
    onOpenLibrary,
    onOpenPlaylists,
    onOpenSettings,
    playlistsEnabled = true,
    offline = false,
}: Props) {
    const { t } = useDiscoverI18n();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [profile, setProfile] = useState<PlayerProfile | null>(null);
    const [draftLibraryOrder, setDraftLibraryOrder] = useState<string[] | null>(null);
    const [homeSwitchOpen, setHomeSwitchOpen] = useState(false);
    const [homeSwitchUsers, setHomeSwitchUsers] = useState<PlexHomeProfile[]>([]);
    const [homeSwitchCurrentId, setHomeSwitchCurrentId] = useState<string | null>(null);
    const [homeSwitchRememberUserId, setHomeSwitchRememberUserId] = useState<string | null>(null);
    const [homeSwitchAvailable, setHomeSwitchAvailable] = useState(false);
    const [homeSwitchBusy, setHomeSwitchBusy] = useState(false);
    const [homeSwitchError, setHomeSwitchError] = useState('');
    const isPlexClient = typeof window !== 'undefined' && Boolean(window.__PLEX_CLIENT__);
    const orderedLibraries = applyLibraryNavOrder(libraries, draftLibraryOrder || libraryOrder);
    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    const loadHomeProfiles = useCallback(async () => {
        try {
            const data = await apiFetch('/api/auth/plex/home-profiles');
            const users = Array.isArray(data?.users) ? data.users : [];
            const available = !!data?.available && users.length > 1;
            setHomeSwitchUsers(users);
            setHomeSwitchCurrentId(data?.currentUserId || null);
            setHomeSwitchRememberUserId(data?.rememberUserId || null);
            setHomeSwitchAvailable(available);
            return { available, users };
        } catch {
            setHomeSwitchAvailable(false);
            setHomeSwitchUsers([]);
            return { available: false, users: [] as PlexHomeProfile[] };
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchMediaPlayerMe()
            .then((data) => {
                if (!cancelled) setProfile(data);
            })
            .catch(() => {
                if (!cancelled) setProfile(null);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!isTvShell || !expanded) return undefined;
        const id = window.setTimeout(() => {
            const root = document.querySelector('[data-tv-nav-root="1"]');
            if (!root) return;
            const active = root.querySelector<HTMLElement>('[data-tv-nav="1"][data-tv-nav-active="1"]');
            const first = root.querySelector<HTMLElement>('[data-tv-nav="1"]');
            const target = active || first;
            if (target && !root.contains(document.activeElement)) target.focus();
        }, 30);
        return () => window.clearTimeout(id);
    }, [expanded, isTvShell]);

    useEffect(() => {
        if (isTvShell && !expanded) return undefined;
        void loadHomeProfiles();
        return undefined;
    }, [expanded, isTvShell, loadHomeProfiles]);

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
    }, [libraryOrder]);

    useEffect(() => {
        if (!mobileOpen) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setMobileOpen(false);
        };
        window.addEventListener('keydown', onKey);
        const unlock = lockBackgroundScroll();
        return () => {
            window.removeEventListener('keydown', onKey);
            unlock();
        };
    }, [mobileOpen]);

    const closeMobile = () => setMobileOpen(false);

    const go = (action: () => void) => {
        action();
        closeMobile();
        if (isTvShell) {
            try {
                delete document.documentElement.dataset.tvNavOpen;
            } catch {
                /* ignore */
            }
            window.dispatchEvent(new CustomEvent(PLAYER_TV_NAV_EVENT, { detail: { action: 'close' } }));
            // Next frame is enough — long timeouts make nav exits feel laggy on TV.
            window.requestAnimationFrame(() => focusTvContent());
        }
    };

    const openHomeSwitcher = async () => {
        setHomeSwitchError('');
        closeMobile();
        if (isTvShell) {
            try {
                delete document.documentElement.dataset.tvNavOpen;
            } catch {
                /* ignore */
            }
            window.dispatchEvent(new CustomEvent(PLAYER_TV_NAV_EVENT, { detail: { action: 'close' } }));
        }
        setHomeSwitchOpen(true);
        const result = await loadHomeProfiles();
        if (!result.users.length) {
            setHomeSwitchError(t('mediaPlayerPage.switchUserError'));
        }
    };

    const handleHomeSwitch = async (user: PlexHomeProfile, pin: string | undefined, remember: boolean) => {
        setHomeSwitchBusy(true);
        setHomeSwitchError('');
        try {
            await apiFetch('/api/auth/plex/home-profiles/switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    remember: remember === true,
                    ...(pin ? { pin } : {}),
                }),
            });
            invalidatePlayerHomeCache();
            clearPlayerLibrariesCache();
            clearHeroSlidesCache();
            window.location.reload();
        } catch (err: any) {
            setHomeSwitchError(err?.message || t('mediaPlayerPage.switchUserError'));
            setHomeSwitchBusy(false);
        }
    };

    const renderNav = (showLabels: boolean, desktop = false) => {
        // Collapsed: Home / Search / Settings / avatar only. Libraries + logout appear when expanded.
        const compact = !showLabels;
        return (
        <nav className={`flex max-h-full min-h-0 flex-col ${showLabels ? 'gap-3 px-2.5 py-3' : 'items-center gap-1.5 px-1.5 py-2.5'}`}>
            {desktop && !isTvShell ? (
                <button
                    type="button"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                    onClick={onToggleExpanded}
                    title={expanded ? t('mediaPlayerPage.collapseNav') : t('mediaPlayerPage.expandNav')}
                    aria-label={expanded ? t('mediaPlayerPage.collapseNav') : t('mediaPlayerPage.expandNav')}
                >
                    <Menu className="h-4 w-4 shrink-0" />
                </button>
            ) : null}
            {offline && showLabels ? (
                <div
                    className="mx-1 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-amber-100/90"
                    aria-live="polite"
                >
                    {t('mediaPlayerPage.offlineBadge')}
                </div>
            ) : null}
            {offline && compact ? (
                <div
                    className="mb-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/15"
                    title={t('mediaPlayerPage.offlineBadge')}
                    aria-label={t('mediaPlayerPage.offlineBadge')}
                    aria-live="polite"
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                </div>
            ) : null}
            <div className={`flex shrink-0 flex-col ${showLabels ? 'gap-1' : 'items-center gap-1'}`}>
                <button
                    type="button"
                    {...tvNavProps(isTvShell, expanded, page === 'home')}
                    className={navButtonClass(page === 'home', showLabels, isTvShell)}
                    onClick={() => go(onHome)}
                    title={t('mediaPlayerPage.navHome')}
                >
                    <Home className="h-4 w-4 shrink-0" />
                    {showLabels ? <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.navHome')}</span> : null}
                </button>
                <button
                    type="button"
                    {...tvNavProps(isTvShell, expanded, page === 'watchlist')}
                    className={navButtonClass(page === 'watchlist', showLabels, isTvShell)}
                    onClick={() => go(onWatchlist)}
                    title={t('mediaPlayerPage.navWatchlist')}
                >
                    <Bookmark className="h-4 w-4 shrink-0" />
                    {showLabels ? <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.navWatchlist')}</span> : null}
                </button>
                <button
                    type="button"
                    {...tvNavProps(isTvShell, expanded, false)}
                    className={navButtonClass(false, showLabels, isTvShell)}
                    onClick={() => go(onSearch)}
                    title={t('mediaPlayerPage.navSearch')}
                >
                    <Search className="h-4 w-4 shrink-0" />
                    {showLabels ? <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.navSearch')}</span> : null}
                </button>
            </div>

            {showLabels && (orderedLibraries.length || (playlistsEnabled && onOpenPlaylists)) ? (
                <div
                    data-tv-nav-libraries="1"
                    className="flex min-h-0 flex-1 flex-col gap-1"
                >
                    {orderedLibraries.length ? (
                        <div className="flex shrink-0 items-center gap-2 px-3 pb-1 pt-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                                {t('mediaPlayerPage.navLibraries')}
                            </p>
                            <div className="h-px min-w-0 flex-1 bg-white/10" />
                        </div>
                    ) : null}
                    <div
                        data-tv-nav-libraries-scroll="1"
                        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto hide-scrollbar px-1 py-0.5"
                    >
                        {orderedLibraries.map((section) => {
                            const Icon = libraryIcon(section.type);
                            const active = page === 'library' && String(activeLibraryKey) === String(section.key);
                            return (
                                <button
                                    key={section.key}
                                    type="button"
                                    {...tvNavProps(isTvShell, expanded, active)}
                                    className={navButtonClass(active, showLabels, isTvShell)}
                                    onClick={() => go(() => onOpenLibrary(section))}
                                    title={section.title}
                                >
                                    <Icon className="h-4 w-4 shrink-0" />
                                    <span className="player-nav-label min-w-0 truncate">{section.title}</span>
                                </button>
                            );
                        })}
                        {playlistsEnabled && onOpenPlaylists ? (
                            <button
                                type="button"
                                {...tvNavProps(isTvShell, expanded, page === 'playlists')}
                                className={navButtonClass(page === 'playlists', showLabels, isTvShell)}
                                onClick={() => go(onOpenPlaylists)}
                                title={t('mediaPlayerPage.playlists')}
                            >
                                <ListMusic className="h-4 w-4 shrink-0" />
                                <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.playlists')}</span>
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className={`flex shrink-0 flex-col ${
                showLabels ? 'gap-1 border-t border-white/10 pt-3' : 'items-center gap-1 pt-1'
            }`}>
                {compact ? <div className="mb-1 h-px w-5 bg-white/15" /> : null}
                <button
                    type="button"
                    {...tvNavProps(isTvShell, expanded, page === 'settings')}
                    className={navButtonClass(page === 'settings', showLabels, isTvShell)}
                    onClick={() => go(onOpenSettings)}
                    title={t('mediaPlayerPage.navSettings')}
                >
                    <Settings className="h-4 w-4 shrink-0" />
                    {showLabels ? <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.navSettings')}</span> : null}
                </button>
                {showLabels && isPlexClient ? (
                    <button
                        type="button"
                        {...tvNavProps(isTvShell, expanded, false)}
                        className={navButtonClass(false, showLabels, isTvShell)}
                        onClick={() => go(logoutMediaPlayer)}
                        title={t('mediaPlayerPage.logOut')}
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.logOut')}</span>
                    </button>
                ) : null}
                {showLabels && !isTvShell && !isPlexClient ? (
                    <button
                        type="button"
                        {...tvNavProps(isTvShell, expanded, false)}
                        className={navButtonClass(false, showLabels, isTvShell)}
                        onClick={() => go(exitToPortal)}
                        title={t('mediaPlayerPage.exitToPortal')}
                    >
                        <LogOut className="h-4 w-4 shrink-0" />
                        <span className="player-nav-label min-w-0 truncate">{t('mediaPlayerPage.exitToPortal')}</span>
                    </button>
                ) : null}
                <button
                    type="button"
                    {...tvNavProps(isTvShell, expanded, false)}
                    className={showLabels
                        ? 'mt-1 flex min-w-0 w-full items-center gap-3 rounded-full px-2 py-1.5 text-left hover:bg-white/10'
                        : 'flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10'}
                    onClick={() => { void openHomeSwitcher(); }}
                    title={t('mediaPlayerPage.switchUser')}
                >
                    <NavAvatar
                        key={profile?.thumb || profile?.username || 'avatar'}
                        profile={profile}
                        sizeClass={showLabels ? 'h-9 w-9' : 'h-7 w-7'}
                    />
                    {showLabels ? (
                        <>
                            <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">
                                {t('mediaPlayerPage.switchUser')}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-white/40" />
                        </>
                    ) : null}
                </button>
            </div>
        </nav>
        );
    };

    return (
        <>
            {!isTvShell && page !== 'other' ? (
                <div className="player-phone-topbar">
                    <button
                        type="button"
                        className="player-phone-nav-toggle"
                        onClick={() => setMobileOpen(true)}
                        aria-label={t('mediaPlayerPage.expandNav')}
                    >
                        <Menu className="h-4 w-4" />
                    </button>
                </div>
            ) : null}

            <aside
                className={`player-desktop-nav pointer-events-none z-40 pl-3 ${
                    isTvShell
                        ? 'fixed inset-y-0 left-0 flex items-center'
                        : 'absolute inset-y-0 left-0 hidden items-center md:flex'
                }`}
            >
                <div
                    data-tv-nav-root="1"
                    className={`pointer-events-auto flex max-h-[calc(100%-3rem)] flex-col rounded-[28px] bg-[#0b1018]/80 backdrop-blur-2xl transition-[width] duration-200 ${
                        isTvShell ? 'border-0 shadow-none' : 'border border-white shadow-[0_18px_50px_rgba(0,0,0,0.45)]'
                    } ${
                        isTvShell ? 'overflow-x-visible overflow-y-auto' : 'overflow-hidden'
                    } ${
                        expanded
                            ? `w-[16.25rem] ${isTvShell ? 'h-[calc(100%-3rem)]' : ''}`
                            : 'w-[4.25rem]'
                    }`}
                >
                    {renderNav(expanded, true)}
                </div>
            </aside>

            {mobileOpen ? (
                <div className="player-mobile-nav-sheet fixed inset-0 z-[80]">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/60"
                        aria-label={t('mediaPlayerPage.closeNav')}
                        onClick={closeMobile}
                    />
                    <aside className="player-phone-nav-panel relative mx-3 mb-3 mt-[max(0.75rem,env(safe-area-inset-top,0px))] flex max-h-[calc(100%-1.5rem-env(safe-area-inset-top,0px))] w-[min(20rem,86vw)] flex-col overflow-hidden rounded-[28px] border border-white bg-[#0b1018]/95 shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
                        <button
                            type="button"
                            onClick={closeMobile}
                            className="absolute right-2 top-3 z-10 rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white"
                            aria-label={t('mediaPlayerPage.closeNav')}
                        >
                            <X className="h-4 w-4" />
                        </button>
                        {renderNav(true)}
                    </aside>
                </div>
            ) : null}

            <PlexHomeSwitchModal
                open={homeSwitchOpen}
                users={homeSwitchUsers}
                currentUserId={homeSwitchCurrentId}
                rememberUserId={homeSwitchRememberUserId}
                showRemember={!isTvShell}
                rememberDefault={!!homeSwitchRememberUserId}
                busy={homeSwitchBusy}
                error={homeSwitchError}
                onSelect={handleHomeSwitch}
                onClose={() => {
                    if (homeSwitchBusy) return;
                    setHomeSwitchOpen(false);
                    if (isTvShell) window.requestAnimationFrame(() => focusTvContent());
                }}
            />
        </>
    );
});
