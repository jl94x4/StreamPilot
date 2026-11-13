import { Activity,AppWindow,ArrowUpCircle,BarChart3,BookOpen,Calendar,ChevronLeft,ChevronRight,Clapperboard,ClipboardList,Cpu,DownloadCloud,FileText,Film,Home,Image as ImageIcon,Info,Layers,LifeBuoy,LogOut,MessageSquare,MonitorSmartphone,MoreHorizontal,Music,Palette,PlayCircle,Radar,Settings,Shield,SlidersHorizontal,Sparkles,Trophy,User as UserIcon,Users,Wand2,X } from 'lucide-react';
import React,{ useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from 'react';
import ReactDOM from 'react-dom';

import { buildArrPortalEmbedHref } from '../../lib/arr-portal-embed.js';
import { ProfileBadgeRack } from '../achievements/AchievementsDashboard';
import { useDiscoverI18n } from '../discovery/i18n';
import { DEFAULT_USER_AVATAR } from '../profile/helpers';
import { apiFetch,apiFetchShared } from '../shared/api';
import { AppletsPalette } from '../shared/AppletsPalette';
import { logoUrl,portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import { AlphaBadge,BetaBadge } from '../shared/BetaBadge';
import { APPLETS_NAV_KEY,buildDesktopNavOrder,canAccessCustomNavTab,customNavTabKey,resolveCustomNavIcon } from '../shared/customNavTabs';
import { readDesktopNavIconsOnly,writeDesktopNavIconsOnly } from '../shared/desktopNavCollapse';
import { InAppNotificationsBell } from '../shared/InAppNotificationsBell';
import { MOBILE_NAV_PRIMARY_SLOTS,ensureCompleteNavOrder,filterNavOrder,resolveMemberNavOrder,type NavFeatureFlags } from '../shared/nav';
import { applyAppletPaletteOrder,getAppletPaletteAccountKey,readAppletPaletteOrder,sortCustomNavTabsByNavOrder,writeAppletPaletteOrder,type OpenAppletSession } from '../shared/openApplets';
import { PlexHomeSwitchModal } from '../shared/PlexHomeSwitchModal';
import {
clearDeferredInstallPrompt,
subscribeInstallPrompt,
wasInstallPromptSeenThisSession,
type BeforeInstallPromptEvent,
} from '../shared/pwaInstallPrompt';
import { ToastContainer,pushToast } from '../shared/toast';
import type { CustomNavTab,ToastMessage } from '../shared/types';
import { CustomSelect } from '../shared/ui';
import { isFirefoxMobileClient,useFirefoxMobileNavShell } from '../shared/useFirefoxMobileNavShell';
import { isIosDevice } from '../shared/webPushSubscribe';
import { updateFavicon } from './common';



interface NavigationProps {
    currentRoute: string;
    onNavigate: (
        route: 'admin' | 'user' | 'status' | 'dashboard' | 'settings' | 'logs' | 'analytics' | 'downloads' | 'mediastack' | 'maintenance' | 'upgrader' | 'collexions' | 'spotify-sync' | 'scanner' | 'media-automation' | 'poster-sets' | 'overlays' | 'editions' | 'watch-sync' | 'requests' | 'discovery' | 'about' | 'achievements' | 'support' | 'chat' | 'preferences' | 'help' | 'profile' | 'external',
        options?: { hash?: string; reviewId?: number; path?: string },
    ) => void;
    onLogout: () => void;
    onSessionRefresh?: () => Promise<void> | void;
    isAdmin: boolean;
    serverName: string;
    adminThumb?: string | null;
    customLogoUrl?: string | null;
    requestUrl: string;
    navOrder: string[];
    navHiddenKeys?: string[];
    memberNavOrder?: string[];
    memberNavHiddenKeys?: string[];
    navFeatures?: NavFeatureFlags;
    appVersion?: string;
    activeTheme: string;
    setActiveTheme: (theme: string) => void;
    pendingRequestCount?: number;
    supportUnreadCount?: number;
    chatUnreadCount?: number;
    watchingCount?: number;
    downloadCount?: number;
    mediaAutomationActiveCount?: number;
    showDashboardWatchingBadge?: boolean;
    sessionInfo?: any;
    mediaServerType?: string;
    sidebarIdentityPosition?: 'top' | 'bottom';
    externalTabId?: string | null;
    openApplets?: OpenAppletSession[];
    onCloseApplet?: (id: string) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentRoute, onNavigate, onLogout, onSessionRefresh, isAdmin, serverName, adminThumb, customLogoUrl, requestUrl, navOrder, navHiddenKeys, memberNavOrder, memberNavHiddenKeys, navFeatures, appVersion, activeTheme, setActiveTheme, pendingRequestCount = 0, supportUnreadCount = 0, chatUnreadCount = 0, watchingCount = 0, downloadCount = 0, mediaAutomationActiveCount = 0, showDashboardWatchingBadge = false, sessionInfo, mediaServerType = 'plex', sidebarIdentityPosition = 'bottom', externalTabId = null, openApplets = [], onCloseApplet }) => {
    const { t } = useDiscoverI18n();
    const resolveNavAvatar = (thumb?: string | null) => {
        const raw = String(thumb || '').trim();
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/api/')) {
            return resolvePortalAssetUrl(raw);
        }
        return portalUrl(`/api/plex/image?path=${encodeURIComponent(raw)}&width=256&height=256`);
    };
    const brandIcon = customLogoUrl
        ? resolvePortalAssetUrl(customLogoUrl)
        : (resolveNavAvatar(adminThumb) || logoUrl());
    const providerName = String(mediaServerType || 'plex').toLowerCase() === 'jellyfin'
        ? 'Jellyfin'
        : String(mediaServerType || 'plex').toLowerCase() === 'emby'
            ? 'Emby'
            : 'Plex';
    const profile = sessionInfo?.account || sessionInfo?.session || {};
    const profileName = profile?.username || sessionInfo?.session?.username || 'Profile';
    const profileEmail = profile?.email || sessionInfo?.session?.email || '';
    const profileThumb = sessionInfo?.session?.thumb || profile?.thumb || (isAdmin ? adminThumb : null);
    const profileIcon = resolveNavAvatar(profileThumb) || DEFAULT_USER_AVATAR;
    const serverIcon = (customLogoUrl || isAdmin) ? brandIcon : profileIcon;
    const usingBrandWordmark = Boolean(customLogoUrl) || /\/(?:static\/)?logo\.(png|jpg|jpeg|webp)(?:\?|$)/i.test(String(serverIcon || ''));
    const onProfileImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (image.dataset.fallback === '1') return;
        image.dataset.fallback = '1';
        image.src = DEFAULT_USER_AVATAR;
    };
    const onIdentityImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
        if (customLogoUrl || isAdmin) {
            event.currentTarget.src = logoUrl();
            return;
        }
        onProfileImageError(event);
    };
    useEffect(() => {
        updateFavicon(brandIcon);
    }, [brandIcon]);

    const [mobileThemeOpen, setMobileThemeOpen] = useState(false);
    const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
    const [firefoxMobileNav] = useState(() => isFirefoxMobileClient());
    const firefoxNavBarRef = useRef<HTMLDivElement>(null);
    const [profileOpen, setProfileOpen] = useState(false);
    const [homeSwitchOpen, setHomeSwitchOpen] = useState(false);
    const [homeSwitchUsers, setHomeSwitchUsers] = useState<any[]>([]);
    const [homeSwitchCurrentId, setHomeSwitchCurrentId] = useState<string | null>(null);
    const [homeSwitchAvailable, setHomeSwitchAvailable] = useState(false);
    const [homeSwitchBusy, setHomeSwitchBusy] = useState(false);
    const [homeSwitchError, setHomeSwitchError] = useState('');
    const [homeSwitchRememberUserId, setHomeSwitchRememberUserId] = useState<string | null>(null);
    const [profileAchievements, setProfileAchievements] = useState<any>(null);
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [installHelpOpen, setInstallHelpOpen] = useState(false);
    const [installBannerDismissed, setInstallBannerDismissed] = useState(() => {
        try {
            return localStorage.getItem('portal.pwa.installBannerDismissed.v1') === '1';
        } catch {
            return false;
        }
    });
    const [isInstalledApp, setIsInstalledApp] = useState(() => (
        typeof window !== 'undefined'
        && (window.matchMedia?.('(display-mode: standalone)').matches
            || window.matchMedia?.('(display-mode: fullscreen)').matches
            || (navigator as any).standalone === true)
    ));
    const [installToasts, setInstallToasts] = useState<ToastMessage[]>([]);
    const addInstallToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setInstallToasts((prev) => pushToast(prev, message, type));
    }, []);

    const loadPlexHomeProfiles = useCallback(async () => {
        if (String(mediaServerType || 'plex').toLowerCase() !== 'plex') {
            setHomeSwitchAvailable(false);
            return { available: false, users: [] as any[] };
        }
        if (sessionInfo?.impersonation?.active) {
            setHomeSwitchAvailable(false);
            return { available: false, users: [] as any[] };
        }
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
            return { available: false, users: [] as any[] };
        }
    }, [mediaServerType, sessionInfo?.impersonation?.active, sessionInfo?.session?.plexId]);

    useEffect(() => {
        void loadPlexHomeProfiles();
    }, [loadPlexHomeProfiles]);

    const openPlexHomeSwitcher = useCallback(async () => {
        setHomeSwitchError('');
        setHomeSwitchOpen(true);
        const result = await loadPlexHomeProfiles();
        if (!result.available) {
            setHomeSwitchOpen(false);
            onNavigate('profile');
        }
    }, [loadPlexHomeProfiles, onNavigate]);

    const handlePlexHomeAvatarClick = useCallback(() => {
        if (homeSwitchAvailable) {
            void openPlexHomeSwitcher();
            return;
        }
        onNavigate('profile');
    }, [homeSwitchAvailable, openPlexHomeSwitcher, onNavigate]);

    const handlePlexHomeSwitch = useCallback(async (user: { id: string }, pin: string | undefined, remember: boolean) => {
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
            window.location.reload();
        } catch (e: any) {
            setHomeSwitchError(e?.message || 'Could not switch Plex Home profile.');
            setHomeSwitchBusy(false);
        }
    }, []);
    useFirefoxMobileNavShell({ barRef: firefoxNavBarRef, enabled: firefoxMobileNav });
    const mobileThemeRef = useRef<HTMLDivElement>(null);
    const [mobileThemePos, setMobileThemePos] = useState<{ top: number; right: number } | null>(null);
    const isFirefoxMobile = typeof navigator !== 'undefined'
        && /Firefox/i.test(navigator.userAgent)
        && /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent);
    const isAndroidChrome = typeof navigator !== 'undefined'
        && /Android/i.test(navigator.userAgent)
        && /Chrome|CriOS|EdgA|SamsungBrowser/i.test(navigator.userAgent)
        && !/Firefox/i.test(navigator.userAgent);
    // iOS never fires beforeinstallprompt — Share → Add to Home Screen only.
    // Include iPadOS desktop UA + Chrome/Firefox on iOS (same WebKit A2HS path).
    const isIosInstallClient = isIosDevice();
    const showInstallNudge = !isInstalledApp && !installBannerDismissed && (!!installPrompt || isIosInstallClient || isFirefoxMobile);
    const [installDiag, setInstallDiag] = useState<string[] | null>(null);

    const dismissInstallBanner = useCallback(() => {
        setInstallBannerDismissed(true);
        try {
            localStorage.setItem('portal.pwa.installBannerDismissed.v1', '1');
        } catch {
            /* ignore */
        }
    }, []);

    const clearInstallBannerDismiss = useCallback(() => {
        setInstallBannerDismissed(false);
        try {
            localStorage.removeItem('portal.pwa.installBannerDismissed.v1');
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        if (!profileOpen) return;
        if (!navFeatures?.achievements) {
            setProfileAchievements(null);
            return;
        }
        let cancelled = false;
        apiFetchShared('/api/achievements/me?view=summary')
            .then((data) => {
                if (!cancelled) setProfileAchievements(data);
            })
            .catch(() => {
                if (!cancelled) setProfileAchievements(null);
            });
        return () => { cancelled = true; };
    }, [profileOpen, navFeatures?.achievements]);

    useEffect(() => {
        const unsubscribe = subscribeInstallPrompt((event) => {
            setInstallPrompt(event);
        });
        const handleInstalled = () => {
            setIsInstalledApp(true);
            clearDeferredInstallPrompt();
            setInstallPrompt(null);
            setInstallHelpOpen(false);
            dismissInstallBanner();
            addInstallToast(t('pwa.install.successBody', { server: serverName }), 'success');
        };
        const syncInstalledState = () => {
            const installed = window.matchMedia?.('(display-mode: standalone)').matches
                || window.matchMedia?.('(display-mode: fullscreen)').matches
                || (navigator as any).standalone === true;
            setIsInstalledApp(!!installed);
            if (installed) dismissInstallBanner();
        };
        syncInstalledState();
        window.addEventListener('appinstalled', handleInstalled);
        const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
        standaloneMq?.addEventListener?.('change', syncInstalledState);
        return () => {
            unsubscribe();
            window.removeEventListener('appinstalled', handleInstalled);
            standaloneMq?.removeEventListener?.('change', syncInstalledState);
        };
    }, [addInstallToast, dismissInstallBanner, serverName, t]);

    useEffect(() => {
        if (!installHelpOpen) {
            setInstallDiag(null);
            return;
        }
        let cancelled = false;
        (async () => {
            const notes: string[] = [];
            const secure = window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location.hostname);
            if (!secure || window.location.protocol !== 'https:') {
                if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    notes.push('Site is not HTTPS — Firefox will not install a PWA over plain HTTP. Open the portal via your HTTPS URL (reverse proxy / tunnel), not http://IP:port.');
                }
            }
            try {
                if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !/Firefox/i.test(navigator.userAgent || '')) {
                    try {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        if (!regs.length) {
                            notes.push('No service worker registered yet — Chrome Android needs one for Install (not just Create shortcut). Reload once over HTTPS and try again.');
                        } else if (!navigator.serviceWorker.controller) {
                            notes.push('Service worker is registered but not controlling this page yet — reload once, then retry Install.');
                        } else {
                            const active = regs[0]?.active;
                            if (active?.scriptURL) {
                                notes.push(`Service worker: ${active.scriptURL} (scope ${regs[0]?.scope || '?'})`);
                            }
                        }
                    } catch {
                        // ignore SW probe failures
                    }
                }
                try {
                    const related = typeof (navigator as any).getInstalledRelatedApps === 'function'
                        ? await (navigator as any).getInstalledRelatedApps()
                        : null;
                    if (Array.isArray(related) && related.length) {
                        notes.push('Chrome reports a related app may already be installed — remove the home-screen icon / WebAPK, then clear site data if Install stays missing.');
                    }
                } catch {
                    // ignore related-apps probe
                }
                const manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
                const manifestHref = manifestLink?.href || portalUrl('/manifest.webmanifest');
                const manifestRes = await fetch(manifestHref, { credentials: 'same-origin', cache: 'no-store' });
                if (!manifestRes.ok) {
                    notes.push(`Manifest failed to load (${manifestRes.status}).`);
                } else {
                    const manifest = await manifestRes.json();
                    const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
                    if (!manifest.name && !manifest.short_name) notes.push('Manifest is missing a name.');
                    if (!manifest.start_url) notes.push('Manifest is missing start_url.');
                    if (!icons.length) notes.push('Manifest has no icons.');
                    for (const icon of icons.slice(0, 3)) {
                        try {
                            const iconUrl = new URL(String(icon.src || ''), window.location.href).toString();
                            const iconRes = await fetch(iconUrl, { credentials: 'same-origin', cache: 'no-store' });
                            if (!iconRes.ok) {
                                notes.push(`Icon failed (${icon.sizes || '?'}): ${iconRes.status}`);
                                continue;
                            }
                            const type = (iconRes.headers.get('content-type') || '').toLowerCase();
                            if (type && !type.includes('image/')) {
                                notes.push(`Icon is not an image (${icon.sizes || '?'}): ${type}`);
                            }
                        } catch {
                            notes.push(`Icon could not be fetched (${icon.sizes || '?'}).`);
                        }
                    }
                    const blockingNotes = notes.filter((n) => !n.startsWith('Service worker:'));
                    if (!blockingNotes.length) {
                        if (isAndroidChrome && !installPrompt) {
                            if (wasInstallPromptSeenThisSession()) {
                                notes.push('Chrome offered Install earlier this visit, but the prompt was used or dismissed. Stay on the page, tap once, hard-reload, then try again — or use Chrome ⋮ → Install app.');
                            } else {
                                notes.push('Chrome has not marked this visit installable yet. Stay on the portal over HTTPS for ~30 seconds, tap once, then hard-reload (so the service worker updates). Or use Chrome’s menu ⋮ → Install app / Install page. If you only see Create shortcut, clear site data for this site and try again.');
                            }
                        }
                        notes.push('Manifest and icons look OK. Chrome Android: in-app Install (top bar / More), or browser ⋮ → Install app. Firefox: ⋮ → Install.');
                    }
                }
            } catch {
                notes.push('Could not verify the web app manifest from this device.');
            }
            if (!cancelled) setInstallDiag(notes);
        })();
        return () => { cancelled = true; };
    }, [installHelpOpen, installPrompt, isAndroidChrome]);

    const handleInstallApp = async () => {
        if (isInstalledApp) {
            addInstallToast(t('pwa.install.openInstalled'), 'success');
            return;
        }
        // Firefox / iOS / most non-Chromium browsers never fire beforeinstallprompt —
        // always show manual install steps instead of appearing to do nothing.
        if (!installPrompt || isFirefoxMobile || isIosInstallClient) {
            setInstallHelpOpen(true);
            return;
        }
        const promptEvent = installPrompt;
        dismissInstallBanner();
        try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            // Event is spent after prompt() — clear only after choice settles.
            clearDeferredInstallPrompt();
            setInstallPrompt(null);
            if (choice.outcome === 'accepted') {
                setIsInstalledApp(true);
                addInstallToast(t('pwa.install.successBody', { server: serverName }), 'success');
            } else {
                dismissInstallBanner();
            }
        } catch {
            setInstallHelpOpen(true);
        }
    };
    const handleInstallAppRef = useRef(handleInstallApp);
    handleInstallAppRef.current = handleInstallApp;

    useEffect(() => {
        const onOpenInstall = () => { void handleInstallAppRef.current(); };
        window.addEventListener('portal-open-install', onOpenInstall);
        return () => window.removeEventListener('portal-open-install', onOpenInstall);
    }, []);

    useEffect(() => {
        if (!mobileThemeOpen) { setMobileThemePos(null); return; }
        if (mobileThemeRef.current) {
            const rect = mobileThemeRef.current.getBoundingClientRect();
            setMobileThemePos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
        }
    }, [mobileThemeOpen]);

    useEffect(() => {
        if (!mobileThemeOpen) return;
        const handler = (e: MouseEvent) => {
            if (mobileThemeRef.current && !mobileThemeRef.current.contains(e.target as Node)) {
                setMobileThemeOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [mobileThemeOpen]);

    const customNavTabs: CustomNavTab[] = Array.isArray(sessionInfo?.customNavTabs) ? sessionInfo.customNavTabs : [];
    const [appletsOpen, setAppletsOpen] = useState(false);
    const [desktopNavIconsOnly, setDesktopNavIconsOnly] = useState(() => {
        const iconsOnly = readDesktopNavIconsOnly();
        writeDesktopNavIconsOnly(iconsOnly);
        return iconsOnly;
    });
    const appletsButtonRef = useRef<HTMLButtonElement>(null);
    const appletAccountKey = useMemo(() => getAppletPaletteAccountKey(sessionInfo), [sessionInfo]);
    const [paletteOrderIds, setPaletteOrderIds] = useState<string[]>([]);
    const paletteOrderAccountRef = useRef('');

    useEffect(() => {
        if (!sessionInfo) return;
        if (paletteOrderAccountRef.current === appletAccountKey) return;
        paletteOrderAccountRef.current = appletAccountKey;
        setPaletteOrderIds(readAppletPaletteOrder(appletAccountKey));
    }, [sessionInfo, appletAccountKey]);

    useEffect(() => {
        setAppletsOpen(false);
    }, [currentRoute, externalTabId]);

    const navItemsConfig: Record<string, { label: string; icon: React.FC<any>; route: string; adminOnly: boolean; beta?: boolean; alpha?: boolean; href?: string; onClick?: (e: any) => void; customTabId?: string; logoUrl?: string }> = useMemo(() => {
        const config: Record<string, { label: string; icon: React.FC<any>; route: string; adminOnly: boolean; beta?: boolean; alpha?: boolean; href?: string; onClick?: (e: any) => void; customTabId?: string; logoUrl?: string }> = {
        'home': { label: t('navigation.home'), icon: Home, route: 'user', adminOnly: false },
        'users': { label: t('navigation.users'), icon: Users, route: 'users', adminOnly: true },
        'discover': { label: t('navigation.dashboard'), icon: Film, route: 'dashboard', adminOnly: false },
        'status': { label: t('navigation.status'), icon: Activity, route: 'status', adminOnly: false },
        'logs': { label: t('navigation.logs'), icon: FileText, route: 'logs', adminOnly: true },
        'analytics': { label: t('navigation.analytics'), icon: BarChart3, route: 'analytics', adminOnly: false },
        'achievements': { label: t('navigation.achievements'), icon: Trophy, route: 'achievements', adminOnly: false },
        'chat': { label: t('navigation.chat'), icon: MessageSquare, route: 'chat', adminOnly: false },
        'support': { label: t('navigation.support'), icon: LifeBuoy, route: 'support', adminOnly: false },
        'help': { label: t('navigation.help'), icon: BookOpen, route: 'help', adminOnly: false },
        'downloads': { label: t('navigation.downloads'), icon: DownloadCloud, route: 'downloads', adminOnly: false },
        'mediastack': { label: t('navigation.calendar'), icon: Calendar, route: 'mediastack', adminOnly: false },
        'maintenance': { label: t('navigation.cleaner'), icon: Shield, route: 'maintenance', adminOnly: true },
        'upgrader': { label: t('navigation.upgrader'), icon: ArrowUpCircle, route: 'upgrader', adminOnly: true },
        'collexions': { label: t('navigation.collexions'), icon: Layers, route: 'collexions', adminOnly: true },
        'spotify-sync': { label: t('navigation.spotifySync'), icon: Music, route: 'spotify-sync', adminOnly: true },
        'metadata-fill': { label: t('navigation.metadataFill'), icon: Wand2, route: 'metadata-fill', adminOnly: true },
        'scanner': { label: t('navigation.scanner'), icon: Radar, route: 'scanner', adminOnly: true },
        'media-automation': { label: t('navigation.mediaAutomation'), icon: Cpu, route: 'media-automation', adminOnly: true },
        'poster-sets': { label: t('navigation.posterSets'), icon: ImageIcon, route: 'poster-sets', adminOnly: true, beta: true },
        'overlays': { label: t('navigation.overlays'), icon: Layers, route: 'overlays', adminOnly: true },
        'editions': { label: t('navigation.editions'), icon: Film, route: 'editions', adminOnly: true },
        'watch-sync': { label: t('navigation.watchSync'), icon: Clapperboard, route: 'watch-sync', adminOnly: true },
        'requests': { label: t('navigation.requests'), icon: ClipboardList, route: 'requests', adminOnly: true },
        'request': { label: t('navigation.discoverRequest'), icon: Sparkles, route: 'discovery', adminOnly: false },
        // Admin-only until member Plex identity is always resolved (owner-token fallback polluted CW).
        'media-player': { label: t('navigation.mediaPlayer'), icon: PlayCircle, route: 'media-player', adminOnly: true, beta: true },
        'about': { label: t('navigation.about'), icon: Info, route: 'about', adminOnly: false },
        'profile': { label: t('navigation.profile'), icon: UserIcon, route: 'profile', adminOnly: false },
        'preferences': { label: t('navigation.preferences'), icon: SlidersHorizontal, route: 'preferences', adminOnly: false },
        'settings': { label: t('navigation.settings'), icon: Settings, route: 'settings', adminOnly: true },
        'logout': { label: t('navigation.logout'), icon: LogOut, route: '', adminOnly: false, onClick: onLogout },
        };
        for (const tab of customNavTabs) {
            if (!tab?.enabled) continue;
            const key = customNavTabKey(tab.id);
            const Icon = resolveCustomNavIcon(tab.icon);
            if (tab.openMode === 'embed') {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: 'external',
                    adminOnly: !!tab.adminOnly,
                    customTabId: tab.id,
                    logoUrl: tab.logoUrl,
                };
            } else if (tab.openMode === 'newTab') {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: '',
                    adminOnly: !!tab.adminOnly,
                    href: tab.url,
                    logoUrl: tab.logoUrl,
                };
            } else {
                config[key] = {
                    label: tab.name,
                    icon: Icon,
                    route: '',
                    adminOnly: !!tab.adminOnly,
                    onClick: () => { window.location.href = tab.url; },
                    logoUrl: tab.logoUrl,
                };
            }
        }
        const navItemIcons = sessionInfo?.navItemIcons && typeof sessionInfo.navItemIcons === 'object'
            ? sessionInfo.navItemIcons
            : {};
        for (const [key, item] of Object.entries(config)) {
            const override = navItemIcons[key];
            if (!override || typeof override !== 'object') continue;
            if (override.icon) item.icon = resolveCustomNavIcon(override.icon);
            if (override.logoUrl) item.logoUrl = override.logoUrl;
        }
        return config;
    }, [customNavTabs, onLogout, t, sessionInfo?.navItemIcons]);
    const normalizedNavOrder = useMemo(() => {
        const order = isAdmin
            ? ensureCompleteNavOrder(navOrder)
            : resolveMemberNavOrder(memberNavOrder, navOrder, customNavTabs);
        const hiddenKeys = isAdmin ? navHiddenKeys : (memberNavHiddenKeys ?? navHiddenKeys);
        return filterNavOrder(order, { isAdmin, features: navFeatures, hiddenKeys, customTabs: customNavTabs });
    }, [navOrder, navHiddenKeys, memberNavOrder, memberNavHiddenKeys, isAdmin, navFeatures, customNavTabs]);

    const visibleApplets = useMemo(
        () => sortCustomNavTabsByNavOrder(
            customNavTabs.filter((tab) => (
                canAccessCustomNavTab(tab, isAdmin)
                && normalizedNavOrder.includes(customNavTabKey(tab.id))
            )),
            normalizedNavOrder,
        ),
        [customNavTabs, isAdmin, normalizedNavOrder],
    );

    const paletteApplets = useMemo(
        () => applyAppletPaletteOrder(visibleApplets, paletteOrderIds),
        [visibleApplets, paletteOrderIds],
    );

    const handlePaletteOrderChange = useCallback((orderIds: string[]) => {
        setPaletteOrderIds(orderIds);
        writeAppletPaletteOrder(appletAccountKey, orderIds);
    }, [appletAccountKey]);

    const desktopNavOrder = useMemo(() => buildDesktopNavOrder(normalizedNavOrder, {
        display: sessionInfo?.customNavDisplay,
        hasVisibleApplets: visibleApplets.length > 0,
    }), [normalizedNavOrder, sessionInfo?.customNavDisplay, visibleApplets.length]);

    const isNavCurrent = (key: string, route: string, customTabId?: string) => {
        if (customTabId) return currentRoute === 'external' && externalTabId === customTabId;
        return ['admin', 'user'].includes(currentRoute) && key === 'home' ? true : currentRoute === route;
    };

    const getNavBadgeCount = (key: string) => {
        if (key === 'request') return pendingRequestCount;
        if (key === 'support') return supportUnreadCount;
        if (key === 'chat') return chatUnreadCount;
        if (key === 'discover' && showDashboardWatchingBadge) return watchingCount;
        if (key === 'downloads') return downloadCount;
        if (key === 'media-automation') return mediaAutomationActiveCount;
        return 0;
    };

    const navListRef = useRef<HTMLDivElement>(null);
    const navCompressStepRef = useRef(0);
    const navCompressSignatureRef = useRef('');
    const navMinCompressStepRef = useRef(0);
    const navTriedExpandRef = useRef(false);
    const navListBoxRef = useRef({ width: 0, height: 0 });
    const [navCompressStep, setNavCompressStep] = useState(0);
    const [navCompressEpoch, setNavCompressEpoch] = useState(0);
    const [navListLayoutTick, setNavListLayoutTick] = useState(0);
    const skipDesktopNavCollapseEffect = useRef(true);
    useEffect(() => {
        writeDesktopNavIconsOnly(desktopNavIconsOnly);
        if (skipDesktopNavCollapseEffect.current) {
            skipDesktopNavCollapseEffect.current = false;
            return;
        }
        setNavCompressEpoch((epoch) => epoch + 1);
        window.dispatchEvent(new Event('resize'));
    }, [desktopNavIconsOnly]);

    const desktopNavKeySignature = useMemo(() => (
        desktopNavOrder.join('|')
    ), [desktopNavOrder]);

    /** Nav link styles — stay readable; logo steps first, then these three. */
    const DESKTOP_NAV_STYLES = [
        { gap: 'gap-2.5', px: 'px-3', py: 'py-1.5', text: 'text-[15px]', icon: 'w-5 h-5' },
        { gap: 'gap-2', px: 'px-3', py: 'py-0.5', text: 'text-sm', icon: 'w-[18px] h-[18px]' },
        { gap: 'gap-1.5', px: 'px-2.5', py: 'py-0.5', text: 'text-[13px]', icon: 'w-4 h-4' },
    ];
    /** Logo / identity — shrinks before nav text gets crushed. */
    const IDENTITY_STYLES = [
        {
            customWrap: 'w-[6.9rem]',
            customImg: 'max-w-[6.9rem] max-h-[5.75rem]',
            round: 'w-[5.75rem] h-[5.75rem]',
            title: 'text-[1.3rem]',
            showPortal: true,
            logoMb: 'mb-2',
            sectionTop: 'pb-2 mb-2',
            sectionBottom: 'pt-2 mt-2',
        },
        {
            customWrap: 'w-[5.25rem]',
            customImg: 'max-w-[5.25rem] max-h-[4.25rem]',
            round: 'w-[4.5rem] h-[4.5rem]',
            title: 'text-[1.15rem]',
            showPortal: true,
            logoMb: 'mb-1.5',
            sectionTop: 'pb-1.5 mb-1.5',
            sectionBottom: 'pt-1.5 mt-1.5',
        },
        {
            customWrap: 'w-[4rem]',
            customImg: 'max-w-[4rem] max-h-[3.25rem]',
            round: 'w-[3.5rem] h-[3.5rem]',
            title: 'text-base',
            showPortal: false,
            logoMb: 'mb-1',
            sectionTop: 'pb-1 mb-1',
            sectionBottom: 'pt-1 mt-1',
        },
        {
            customWrap: 'w-[3.25rem]',
            customImg: 'max-w-[3.25rem] max-h-[2.5rem]',
            round: 'w-[3rem] h-[3rem]',
            title: 'text-sm',
            showPortal: false,
            logoMb: 'mb-0.5',
            sectionTop: 'pb-1 mb-0.5',
            sectionBottom: 'pt-1 mt-0.5',
        },
    ];
    /** Shrink the logo fully before tightening nav labels, so leftover height stays on the items. */
    const NAV_STYLE_BY_STEP = [0, 0, 0, 0, 1, 2];
    const IDENTITY_STYLE_BY_STEP = [0, 1, 2, 3, 3, 3];
    const MAX_NAV_COMPRESS_STEP = NAV_STYLE_BY_STEP.length - 1;

    // One density step per committed layout. Measuring in rAF before React paints
    // the smaller styles raced to max compression (tiny labels + a large gap).
    // After shrinking, step back up when the larger size actually fits.
    useLayoutEffect(() => {
        const nav = navListRef.current;
        if (!nav) return;
        if (desktopNavIconsOnly) return;

        const layoutSignature = `${desktopNavKeySignature}|${sidebarIdentityPosition}|${navCompressEpoch}|${desktopNavIconsOnly ? 'icons' : 'full'}`;
        if (layoutSignature !== navCompressSignatureRef.current) {
            navCompressSignatureRef.current = layoutSignature;
            navMinCompressStepRef.current = 0;
            navTriedExpandRef.current = false;
            if (navCompressStep !== 0) {
                navCompressStepRef.current = 0;
                setNavCompressStep(0);
                return;
            }
        }

        // Flex child may not have a real height yet; compressing from that always hits max.
        if (nav.clientHeight < 32) return;

        const overflow = nav.scrollHeight - nav.clientHeight;
        if (overflow > 1 && navCompressStep < MAX_NAV_COMPRESS_STEP) {
            if (navTriedExpandRef.current) {
                navMinCompressStepRef.current = navCompressStep + 1;
                navTriedExpandRef.current = false;
            }
            const next = navCompressStep + 1;
            navCompressStepRef.current = next;
            setNavCompressStep(next);
            return;
        }

        if (overflow <= 1 && navCompressStep > navMinCompressStepRef.current) {
            navTriedExpandRef.current = true;
            const next = navCompressStep - 1;
            navCompressStepRef.current = next;
            setNavCompressStep(next);
            return;
        }

        navTriedExpandRef.current = false;
    }, [desktopNavKeySignature, sidebarIdentityPosition, navCompressEpoch, navCompressStep, navListLayoutTick, MAX_NAV_COMPRESS_STEP, desktopNavIconsOnly]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                setNavCompressEpoch((epoch) => epoch + 1);
            }, 200);
        };
        window.addEventListener('resize', onResize);

        const nav = navListRef.current;
        let observer: ResizeObserver | undefined;
        if (nav && typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                const width = nav.clientWidth;
                const height = nav.clientHeight;
                const prev = navListBoxRef.current;
                if (Math.abs(width - prev.width) < 2 && Math.abs(height - prev.height) < 2) return;
                navListBoxRef.current = { width, height };
                setNavListLayoutTick((tick) => tick + 1);
            });
            observer.observe(nav);
        }

        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('resize', onResize);
            observer?.disconnect();
        };
    }, []);

    const compressStep = Math.min(Math.max(navCompressStep, 0), MAX_NAV_COMPRESS_STEP);
    const navStyleIndex = desktopNavIconsOnly ? 0 : NAV_STYLE_BY_STEP[compressStep];
    const identityStyleIndex = desktopNavIconsOnly ? 3 : IDENTITY_STYLE_BY_STEP[compressStep];
    const desktopNavDensity = DESKTOP_NAV_STYLES[navStyleIndex];
    const identityDensity = IDENTITY_STYLES[identityStyleIndex];

    const NAV_BETA_NOTICE_KEYS: Record<string, string> = {
        'poster-sets': 'posterSetsPage.betaNotice',
        'media-player': 'mediaPlayerPage.betaNotice',
    };
    const NAV_ALPHA_NOTICE_KEYS: Record<string, string> = {};

    const renderNavAction = (
        key: string,
        item: { label: string; icon: React.FC<any>; route: string; href?: string; onClick?: (e: any) => void; customTabId?: string; beta?: boolean; alpha?: boolean; logoUrl?: string },
        options: { compactLabel?: string; mobile?: boolean; isCurrent: boolean; badgeCount?: number },
    ) => {
        const Icon = item.icon;
        const label = options.compactLabel || item.label;
        const badgeCount = options.badgeCount || 0;
        const betaTitle = item.beta
            ? t(NAV_BETA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.betaNotice')
            : '';
        const alphaTitle = item.alpha
            ? t(NAV_ALPHA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.betaNotice')
            : '';
        const statusBadge = item.alpha
            ? <AlphaBadge title={alphaTitle} />
            : item.beta
                ? <BetaBadge title={betaTitle} />
                : null;
        // Bottom-bar slots are too narrow for label + ALPHA/BETA; pin the chip on the icon
        // (same pattern as the More drawer) so it stays inside the nav chrome.
        const mobileStatusBadge = item.alpha
            ? (
                <AlphaBadge
                    title={alphaTitle}
                    className="absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[6px] leading-none"
                />
            )
            : item.beta
                ? (
                    <BetaBadge
                        title={betaTitle}
                        className="absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[6px] leading-none"
                    />
                )
                : null;
        const desktopDensity = options.mobile ? null : desktopNavDensity;
        const iconsOnly = !options.mobile && desktopNavIconsOnly;
        const logoSrc = item.logoUrl ? resolvePortalAssetUrl(item.logoUrl) : '';
        const iconClass = options.mobile ? 'w-5 h-5' : (desktopDensity?.icon || 'w-5 h-5');
        const mark = logoSrc ? (
            <img src={logoSrc} alt="" className={`${iconClass} object-contain flex-shrink-0`} />
        ) : (
            <Icon className={`${iconClass} flex-shrink-0`} />
        );
        const baseClass = options.mobile
            ? `relative flex flex-col items-center justify-center gap-0.5 h-full flex-1 min-w-0 px-0.5 text-center text-[0.6rem] sm:text-[0.65rem] transition-colors overflow-visible ${options.isCurrent ? 'text-plex font-bold' : 'text-muted hover:text-text'}`
            : iconsOnly
                ? `relative flex w-full items-center justify-center px-0 py-1.5 no-underline rounded-lg transition-colors ${options.isCurrent ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`
                : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium ${options.isCurrent ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`;

        if (item.href) {
            return (
                <a
                    key={key}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    title={label}
                    aria-label={label}
                    className={options.mobile ? baseClass : (
                        iconsOnly
                            ? `${baseClass} text-muted hover:bg-white/5 hover:text-text`
                            : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} text-muted no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium hover:bg-white/5 hover:text-text`
                    )}
                >
                    {mark}
                    {iconsOnly ? <span className="sr-only">{label}</span> : <> {label}</>}
                </a>
            );
        }

        const handleActivate = () => {
            if (options.mobile) setMobileMoreOpen(false);
            if (item.customTabId) {
                onNavigate('external', { path: `/external/${encodeURIComponent(item.customTabId)}` });
                return;
            }
            if (item.onClick) item.onClick({ preventDefault: () => {} });
            else if (item.route) onNavigate(item.route as any);
        };

        return (
            <button
                key={key}
                type="button"
                className={`${baseClass} bg-transparent border-0 cursor-pointer`}
                onClick={handleActivate}
                title={iconsOnly ? label : undefined}
                aria-label={iconsOnly ? label : undefined}
            >
                <span className={`relative shrink-0 ${options.mobile && mobileStatusBadge ? 'mb-1' : ''}`}>
                    {mark}
                    {options.mobile ? mobileStatusBadge : null}
                    {badgeCount > 0 && (options.mobile || iconsOnly) && (
                        <span className="absolute -top-1 -right-1.5 min-w-[14px] h-3.5 px-0.5 rounded-full bg-plex text-background text-[8px] font-bold flex items-center justify-center leading-none">
                            {badgeCount > 9 ? '9+' : badgeCount}
                        </span>
                    )}
                </span>
                {options.mobile ? (
                    <span className="truncate max-w-full leading-tight">{label}</span>
                ) : iconsOnly ? (
                    <span className="sr-only">{label}</span>
                ) : (
                    <span className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="truncate">{label}</span>
                        {statusBadge}
                        {badgeCount > 0 && (
                            <span className="ml-auto min-w-[1.15rem] h-[18px] px-1.5 rounded-full bg-plex text-background text-[10px] font-bold flex items-center justify-center shrink-0">
                                {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                        )}
                    </span>
                )}
                {options.mobile && options.isCurrent && (
                    <div className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-plex shadow-[0_0_5px_rgba(229,160,13,0.8)]" />
                )}
            </button>
        );
    };

    const renderServerIdentity = (placement: 'top' | 'bottom') => {
        const sectionClass = `flex flex-col items-center w-full shrink-0 ${placement === 'top' ? identityDensity.sectionTop : identityDensity.sectionBottom} border-white/10 ${placement === 'top' ? 'border-b' : 'border-t'}`;
        const logoActiveClass = desktopNavIconsOnly && currentRoute === 'profile'
            ? 'ring-2 ring-plex/60 ring-offset-2 ring-offset-[rgb(var(--color-card))]'
            : '';

        const identityContent = (
            <>
                <div className={`relative ${identityDensity.logoMb} ${usingBrandWordmark ? `${identityDensity.customWrap} flex items-center justify-center` : ''}`}>
                    {usingBrandWordmark ? (
                        <img
                            src={serverIcon}
                            alt="Server Logo"
                            className={`${identityDensity.customImg} object-contain drop-shadow-[0_0_24px_rgba(0,0,0,0.75)] ${logoActiveClass}`}
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = logoUrl();
                            }}
                        />
                    ) : (
                        <>
                            <div className="absolute inset-0 bg-plex blur-[29px] opacity-20 rounded-full"></div>
                            <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-plex via-amber-300 to-orange-600 opacity-60"></div>
                            <div className={`relative ${identityDensity.round} rounded-full p-[3px] shadow-2xl bg-card ${logoActiveClass}`}>
                                <div className="w-full h-full rounded-full overflow-hidden bg-background">
                                    <img
                                        src={serverIcon}
                                        alt="Server Logo"
                                        className="w-full h-full object-cover"
                                        onError={onIdentityImageError}
                                    />
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className={`flex flex-col items-center text-center px-2 ${desktopNavIconsOnly ? 'sr-only' : ''}`}>
                    <h2 className={`${identityDensity.title} font-black text-text tracking-tight leading-tight line-clamp-2`}>
                        {serverName}
                    </h2>
                    {identityDensity.showPortal && (
                        <div className="mt-1 flex items-center gap-2">
                            <div className="h-px w-6 bg-gradient-to-r from-transparent to-plex/50"></div>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-plex font-bold">
                                Portal
                            </span>
                            <div className="h-px w-6 bg-gradient-to-l from-transparent to-plex/50"></div>
                        </div>
                    )}
                </div>
            </>
        );

        if (desktopNavIconsOnly) {
            return (
                <button
                    type="button"
                    onClick={() => onNavigate('profile')}
                    title={profileName}
                    aria-label={profileName}
                    className={`${sectionClass} p-0 bg-transparent border-0 cursor-pointer hover:opacity-90 transition-opacity`}
                >
                    {identityContent}
                </button>
            );
        }

        return (
            <div className={sectionClass}>
                {identityContent}
            </div>
        );
    };

    return (
        <>
            <ToastContainer toasts={installToasts} setToasts={setInstallToasts} />

            {/* Mobile Top Nav — height grows with safe-area so content clears the iOS status bar in PWA */}
            <div className="md:hidden fixed top-0 left-0 right-0 z-50 nav-shell border-b shadow-lg pt-[env(safe-area-inset-top,0px)] overflow-visible">
                <div className="h-16 flex items-center justify-between gap-2 page-x min-w-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <img
                        src={serverIcon}
                        alt="Logo"
                        className={`shrink-0 ${usingBrandWordmark ? 'h-8 w-auto max-w-[7.5rem] object-contain' : 'w-8 h-8 rounded-full object-cover'}`}
                        onError={onIdentityImageError}
                    />
                    <span className="font-bold text-text uppercase tracking-widest text-xs truncate">{serverName}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <InAppNotificationsBell
                        onNavigate={(route, options) => onNavigate(route as any, options)}
                        className="overflow-visible"
                        buttonClassName="relative w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-all overflow-visible"
                    />
                    <div className="relative" ref={mobileThemeRef}>
                        <button
                            onClick={() => setMobileThemeOpen(v => !v)}
                            className={`w-8 h-8 flex items-center justify-center rounded-md border transition-all ${mobileThemeOpen ? 'border-plex text-plex ring-1 ring-plex' : 'border-border text-muted hover:border-plex/50 hover:text-text'}`}
                            title="Change theme"
                        >
                            <Palette className="w-3.5 h-3.5" />
                        </button>
                        {mobileThemeOpen && mobileThemePos && ReactDOM.createPortal(
                            <div
                                style={{ position: 'fixed', top: mobileThemePos.top, right: mobileThemePos.right, zIndex: 99999 }}
                                className="bg-card border border-border rounded-lg shadow-2xl py-1 min-w-[140px]"
                            >
                                {[
                                    { label: 'Dynamic (Chameleon)', value: 'dynamic' },
                                    { label: 'Plex Dark', value: 'plex' },
                                    { label: 'Sleek Slate', value: 'slate' },
                                    { label: 'Nordic Frost', value: 'nordic' },
                                    { label: 'Jellyfin Purple', value: 'jellyfin' },
                                    { label: 'Emerald Green', value: 'emerald' },
                                    { label: 'Neon Midnight', value: 'midnight' },
                                    { label: 'Crimson Red', value: 'crimson' },
                                    { label: 'Deep Amethyst', value: 'amethyst' },
                                    { label: 'Sunset Orange', value: 'sunset' },
                                    { label: 'Ocean Teal', value: 'ocean' },
                                    { label: 'Rose Pink', value: 'rose' },
                                    { label: 'Royal Blue', value: 'royal' },
                                    { label: 'Graphite', value: 'graphite' },
                                    { label: 'Cyber Lime', value: 'cyberlime' },
                                    { label: 'Aurora', value: 'aurora' },
                                ].map(opt => (
                                    <div
                                        key={opt.value}
                                        className={`px-4 py-2.5 cursor-pointer text-sm whitespace-nowrap transition-colors ${activeTheme === opt.value ? 'bg-plex/10 text-plex font-bold' : 'text-text hover:bg-border/40'}`}
                                        onMouseDown={e => { e.preventDefault(); setActiveTheme(opt.value); setMobileThemeOpen(false); }}
                                    >
                                        {opt.label}
                                    </div>
                                ))}
                            </div>,
                            document.body
                        )}
                    </div>
                    {isAdmin && (
                        <button onClick={(e) => { e.preventDefault(); onNavigate('logs'); }} className={`w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-colors ${currentRoute === 'logs' ? 'text-plex border-plex/50' : ''}`}>
                            <FileText className="w-4 h-4" />
                        </button>
                    )}
                    {!isInstalledApp && (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); void handleInstallApp(); }}
                            className={`w-8 h-8 inline-flex items-center justify-center rounded-md border transition-colors ${
                                installPrompt
                                    ? 'border-plex/50 bg-plex/15 text-plex'
                                    : 'border-border text-muted hover:border-plex/40 hover:text-text'
                            }`}
                            title={t('pwa.install.button')}
                            aria-label={t('pwa.install.button')}
                        >
                            <MonitorSmartphone className="w-3.5 h-3.5 shrink-0" />
                        </button>
                    )}
                    {homeSwitchAvailable && (
                        <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); void openPlexHomeSwitcher(); }}
                            className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-plex/50 hover:text-text transition-colors overflow-hidden"
                            title="Switch profile"
                            aria-label="Switch profile"
                        >
                            <img
                                src={profileIcon}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={onProfileImageError}
                            />
                        </button>
                    )}
                    <button onClick={(e) => { e.preventDefault(); onLogout(); }} className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-muted hover:border-red-500/50 hover:text-red-500 transition-colors">
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
                </div>
            </div>


            {/* Desktop Sidebar */}
            <div className="hidden md:flex relative shrink-0 sticky top-0 self-start h-dvh z-20">
            <div className={`flex flex-col h-full nav-shell border-r py-2.5 shadow-2xl overflow-hidden transition-[width,padding] duration-200 ${desktopNavIconsOnly ? 'w-[4.5rem] px-1.5' : 'w-72 px-5'}`}>
                {sidebarIdentityPosition === 'top' && renderServerIdentity('top')}

                <div
                    ref={navListRef}
                    className={`sidebar-nav-scroll flex flex-col justify-start min-h-0 flex-1 ${navStyleIndex > 0 ? 'gap-0' : 'gap-0.5'} py-0.5`}
                    data-nav-density={compressStep}
                >
                    {desktopNavOrder.map((key) => {
                        if (key === APPLETS_NAV_KEY) {
                            const isCurrent = currentRoute === 'external'
                                && visibleApplets.some((tab) => tab.id === externalTabId);
                            const desktopDensity = desktopNavDensity;
                            return (
                                <React.Fragment key={key}>
                                    <button
                                        ref={appletsButtonRef}
                                        type="button"
                                        className={desktopNavIconsOnly
                                            ? `relative flex w-full items-center justify-center px-0 py-1.5 bg-transparent border-0 cursor-pointer no-underline rounded-lg transition-colors ${isCurrent || appletsOpen ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`
                                            : `flex w-full items-center ${desktopDensity?.gap || 'gap-2.5'} ${desktopDensity?.px || 'px-3'} ${desktopDensity?.py || 'py-1.5'} bg-transparent border-0 cursor-pointer no-underline rounded-lg transition-colors ${desktopDensity?.text || 'text-[15px]'} font-medium ${isCurrent || appletsOpen ? 'nav-item-active' : 'text-muted hover:bg-white/5 hover:text-text'}`}
                                        onClick={() => setAppletsOpen((open) => !open)}
                                        aria-expanded={appletsOpen}
                                        aria-haspopup="dialog"
                                        title={desktopNavIconsOnly ? t('navigation.applets') : undefined}
                                        aria-label={t('navigation.applets')}
                                    >
                                        <AppWindow className={`${desktopDensity?.icon || 'w-5 h-5'} flex-shrink-0`} />
                                        {desktopNavIconsOnly
                                            ? <span className="sr-only">{t('navigation.applets')}</span>
                                            : <span className="truncate">{t('navigation.applets')}</span>}
                                    </button>
                                    {appletsOpen ? (
                                        <AppletsPalette
                                            tabs={paletteApplets}
                                            openIds={openApplets.map((session) => session.id)}
                                            activeId={externalTabId}
                                            anchorRef={appletsButtonRef}
                                            onClose={() => setAppletsOpen(false)}
                                            onOrderChange={handlePaletteOrderChange}
                                            onCloseSession={onCloseApplet ? (tab) => onCloseApplet(tab.id) : undefined}
                                            onActivate={(tab) => {
                                                setAppletsOpen(false);
                                                if (tab.openMode === 'embed') {
                                                    const existing = openApplets.find((session) => session.id === tab.id);
                                                    onNavigate('external', {
                                                        path: existing
                                                            ? buildArrPortalEmbedHref(existing.id, existing.embedPath)
                                                            : `/external/${encodeURIComponent(tab.id)}`,
                                                    });
                                                    return;
                                                }
                                                if (tab.openMode === 'newTab') {
                                                    window.open(tab.url, '_blank', 'noopener,noreferrer');
                                                    return;
                                                }
                                                window.location.href = tab.url;
                                            }}
                                        />
                                    ) : null}
                                </React.Fragment>
                            );
                        }
                        const item = navItemsConfig[key];
                        if (!item) return null;
                        if (key === 'logs') return null;
                        const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                        const labelOverride = key === 'mediastack' ? t('navigation.calendar') : item.label;
                        return renderNavAction(key, { ...item, label: labelOverride }, { isCurrent, badgeCount: getNavBadgeCount(key) });
                    })}
                </div>

                {sidebarIdentityPosition !== 'top' && renderServerIdentity('bottom')}

                {desktopNavIconsOnly ? (
                    <div className="mt-1 pt-1 border-t border-white/10 shrink-0 w-full flex flex-col items-center gap-1.5">
                        <button
                            type="button"
                            onClick={handlePlexHomeAvatarClick}
                            className={`w-9 h-9 rounded-full overflow-hidden border transition-all ${homeSwitchAvailable ? 'border-plex/40 hover:border-plex hover:ring-2 hover:ring-plex/30' : 'border-white/10 hover:border-plex/40'}`}
                            title={homeSwitchAvailable ? 'Switch profile' : profileName}
                            aria-label={homeSwitchAvailable ? 'Switch profile' : profileName}
                        >
                            <img
                                src={profileIcon}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={onProfileImageError}
                            />
                        </button>
                        <InAppNotificationsBell
                            onNavigate={(route, options) => onNavigate(route as any, options)}
                            className="overflow-visible"
                            placement="up"
                            buttonClassName="relative w-9 h-9 flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted hover:text-text hover:border-plex/40 hover:bg-white/10 transition-all overflow-visible"
                        />
                    </div>
                ) : (
                <div className={`${identityStyleIndex >= 3 ? 'mt-1 pt-1' : 'mt-2 pt-2'} border-t border-white/10 shrink-0 w-full min-w-0`}>
                    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-1.5 items-stretch w-full min-w-0">
                        <div
                            className={`min-w-0 flex items-center gap-0.5 rounded-xl border bg-white/5 hover:border-plex/40 transition-all overflow-hidden ${currentRoute === 'profile' ? 'border-plex/50 bg-plex/10' : 'border-white/10'}`}
                        >
                            <button
                                type="button"
                                onClick={handlePlexHomeAvatarClick}
                                className={`flex-shrink-0 rounded-full p-0.5 ml-1 ${homeSwitchAvailable ? 'ring-1 ring-plex/40 hover:ring-plex' : ''}`}
                                title={homeSwitchAvailable ? 'Switch profile' : profileName}
                                aria-label={homeSwitchAvailable ? 'Switch profile' : profileName}
                            >
                                <img
                                    src={profileIcon}
                                    alt=""
                                    className="w-7 h-7 rounded-full object-cover bg-background/60 border border-white/10"
                                    onError={onProfileImageError}
                                />
                            </button>
                            <button
                                type="button"
                                onClick={() => onNavigate('profile')}
                                className="min-w-0 flex flex-1 items-center gap-1.5 py-1 pl-1 pr-0 text-left overflow-hidden hover:bg-white/10 transition-colors"
                            >
                                <div className="min-w-0 flex-1 overflow-hidden">
                                    <p className="text-xs font-bold text-text truncate">{profileName}</p>
                                    <p className="text-[9px] uppercase tracking-wider text-muted truncate">{providerName} Profile</p>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setProfileOpen(true)}
                                className="flex-shrink-0 p-2 mr-0.5 rounded-lg text-plex hover:bg-white/10 transition-colors"
                                title="Change theme"
                                aria-label="Change theme"
                            >
                                <Palette className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <InAppNotificationsBell
                            onNavigate={(route, options) => onNavigate(route as any, options)}
                            className="min-w-0 w-full self-stretch overflow-visible"
                            placement="up"
                            buttonClassName="relative w-full h-full flex items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted hover:text-text hover:border-plex/40 hover:bg-white/10 transition-all overflow-visible"
                        />
                    </div>
                    <div className="mt-1 flex flex-col items-center gap-0.5">
                        {appVersion && (
                            <div className="text-[10px] text-white/50 font-mono tracking-wider opacity-80 hover:opacity-100 transition-opacity">
                                {appVersion}
                            </div>
                        )}
                    </div>
                </div>
                )}
            </div>
            <button
                type="button"
                className="absolute top-1/2 -translate-y-1/2 left-full z-30 flex h-14 w-4 items-center justify-center rounded-r-md border border-l-0 border-white/15 bg-[rgb(var(--color-card))] text-muted shadow-lg hover:bg-white/10 hover:text-text"
                onClick={() => setDesktopNavIconsOnly((current) => !current)}
                title={desktopNavIconsOnly ? t('navigation.expandNav') : t('navigation.collapseNav')}
                aria-label={desktopNavIconsOnly ? t('navigation.expandNav') : t('navigation.collapseNav')}
                aria-pressed={desktopNavIconsOnly}
            >
                {desktopNavIconsOnly
                    ? <ChevronRight className="w-3.5 h-3.5" />
                    : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>
            </div>

            <PlexHomeSwitchModal
                open={homeSwitchOpen}
                users={homeSwitchUsers}
                currentUserId={homeSwitchCurrentId}
                rememberUserId={homeSwitchRememberUserId}
                showRemember
                rememberDefault={!!homeSwitchRememberUserId}
                busy={homeSwitchBusy}
                error={homeSwitchError}
                onSelect={handlePlexHomeSwitch}
                onClose={() => { if (!homeSwitchBusy) setHomeSwitchOpen(false); }}
                onViewProfile={() => {
                    setHomeSwitchOpen(false);
                    onNavigate('profile');
                }}
            />

            {profileOpen && (
                <div className="hidden md:block fixed inset-0 z-[80]" aria-modal="true" role="dialog">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/35 cursor-default"
                        aria-label="Close profile modal"
                        onClick={() => setProfileOpen(false)}
                    />
                    <div
                        className={`absolute bottom-4 rounded-2xl border border-border shadow-2xl overflow-hidden animate-fade-in ${desktopNavIconsOnly ? 'left-[4.75rem] w-64 max-w-[16rem]' : 'left-5 w-[calc(18rem-2.5rem)] max-w-[calc(18rem-2.5rem)]'}`}
                        style={{ backgroundColor: '#12141a' }}
                    >
                        <div
                            className="absolute inset-0"
                            style={{ backgroundColor: 'rgb(var(--color-card))' }}
                            aria-hidden
                        />
                        <div className="relative z-[1]">
                        <div className="p-4 border-b border-border/70">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <img
                                        src={profileIcon}
                                        alt={`${profileName} profile`}
                                        className="w-11 h-11 flex-shrink-0 rounded-full object-cover bg-background/60 border border-white/10"
                                        onError={onProfileImageError}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-base font-black text-text truncate">{profileName}</p>
                                        <p className="text-[10px] uppercase tracking-[0.2em] text-plex font-bold mt-0.5">{providerName} Profile</p>
                                        {profileEmail && <p className="text-xs text-muted truncate mt-1">{profileEmail}</p>}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setProfileOpen(false)}
                                    className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                                    aria-label="Close profile modal"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 space-y-4">
                            {navFeatures?.achievements && profileAchievements?.showOnProfile !== false && (
                                <ProfileBadgeRack
                                    earned={profileAchievements?.earned || []}
                                    level={profileAchievements?.level}
                                    xp={profileAchievements?.xp}
                                    max={16}
                                    onOpenAll={() => {
                                        setProfileOpen(false);
                                        onNavigate('achievements' as any);
                                    }}
                                />
                            )}
                            <div>
                            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted font-bold">
                                <Palette className="w-3.5 h-3.5 text-plex" />
                                Theme
                            </div>
                            <CustomSelect
                                value={activeTheme}
                                onChange={setActiveTheme}
                                compact={true}
                                className="w-full"
                                options={[
                                    { label: 'Dynamic (Chameleon)', value: 'dynamic' },
                                    { label: 'Plex Dark', value: 'plex' },
                                    { label: 'Sleek Slate', value: 'slate' },
                                    { label: 'Nordic Frost', value: 'nordic' },
                                    { label: 'Jellyfin Purple', value: 'jellyfin' },
                                    { label: 'Emerald Green', value: 'emerald' },
                                    { label: 'Neon Midnight', value: 'midnight' },
                                    { label: 'Crimson Red', value: 'crimson' },
                                    { label: 'Deep Amethyst', value: 'amethyst' },
                                    { label: 'Sunset Orange', value: 'sunset' },
                                    { label: 'Ocean Teal', value: 'ocean' },
                                    { label: 'Rose Pink', value: 'rose' },
                                    { label: 'Royal Blue', value: 'royal' },
                                    { label: 'Graphite', value: 'graphite' },
                                    { label: 'Cyber Lime', value: 'cyberlime' },
                                    { label: 'Aurora', value: 'aurora' },
                                ]}
                            />
                            </div>
                            {homeSwitchAvailable && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setProfileOpen(false);
                                        void openPlexHomeSwitcher();
                                    }}
                                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-plex/30 bg-plex/10 px-4 py-3 text-sm font-bold text-plex hover:bg-plex/20 hover:border-plex/50 transition-colors"
                                >
                                    <Users className="w-4 h-4" />
                                    Switch profile
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => {
                                    setProfileOpen(false);
                                    onLogout();
                                }}
                                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200 hover:bg-red-500/20 hover:border-red-400/50 transition-colors"
                            >
                                <LogOut className="w-4 h-4" />
                                {t('navigation.logout')}
                            </button>
                        </div>
                        </div>
                    </div>
                </div>
            )}

            {installHelpOpen && (
                <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm animate-fade-in flex items-center justify-center p-4" aria-modal="true" role="dialog">
                    <button
                        type="button"
                        className="absolute inset-0 cursor-default"
                        aria-label={t('pwa.install.closeHelp')}
                        onClick={() => setInstallHelpOpen(false)}
                    />
                    <div className="relative w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-11 h-11 rounded-xl bg-plex/10 border border-plex/25 flex items-center justify-center text-plex">
                                    <MonitorSmartphone className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-text">{t('pwa.install.helpTitle')}</h3>
                                    <p className="text-xs text-muted">{t('pwa.install.helpSubtitle', { server: serverName })}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setInstallHelpOpen(false)}
                                className="p-2 rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
                                aria-label={t('pwa.install.closeHelp')}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <p className="text-sm text-muted leading-relaxed">
                            {isIosInstallClient
                                ? t('pwa.install.helpIos')
                                : isFirefoxMobile
                                    ? t('pwa.install.helpFirefox')
                                    : isAndroidChrome
                                        ? t('pwa.install.helpAndroidChrome')
                                        : t('pwa.install.helpGeneric')}
                        </p>
                        {installDiag && (
                            <ul className="mt-4 space-y-2 rounded-xl border border-border bg-background/40 p-3 text-xs text-muted">
                                {installDiag.map((note) => (
                                    <li key={note} className="leading-relaxed">• {note}</li>
                                ))}
                            </ul>
                        )}
                        {!installDiag && installHelpOpen && (
                            <p className="mt-4 text-xs text-muted">{t('pwa.install.checking')}</p>
                        )}
                        {(isFirefoxMobile || isAndroidChrome) && (
                            <button
                                type="button"
                                onClick={async () => {
                                    clearInstallBannerDismiss();
                                    clearDeferredInstallPrompt();
                                    setInstallPrompt(null);
                                    try {
                                        if ('serviceWorker' in navigator) {
                                            const regs = await navigator.serviceWorker.getRegistrations();
                                            await Promise.all(regs.map((reg) => reg.unregister()));
                                        }
                                        if ('caches' in window) {
                                            const keys = await caches.keys();
                                            await Promise.all(keys.map((key) => caches.delete(key)));
                                        }
                                    } catch { /* ignore */ }
                                    window.location.reload();
                                }}
                                className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-border px-4 py-3 text-sm font-bold text-text hover:bg-white/5 transition-colors"
                            >
                                {t('pwa.install.resetReload')}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setInstallHelpOpen(false)}
                            className="mt-3 w-full inline-flex items-center justify-center rounded-xl bg-plex px-4 py-3 text-sm font-bold text-background hover:bg-plex-hover transition-colors"
                        >
                            {t('pwa.install.done')}
                        </button>
                    </div>
                </div>
            )}

            {/* Mobile install nudge — Chromium prompt or iOS/Firefox A2HS guidance. */}
            {showInstallNudge && (
                <div className="md:hidden fixed left-3 right-3 z-[90] rounded-2xl border border-plex/40 bg-card/95 shadow-2xl backdrop-blur-md px-3 py-2.5 flex items-center gap-2"
                    style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}
                >
                    <div className="w-9 h-9 rounded-xl bg-plex/15 border border-plex/30 flex items-center justify-center text-plex shrink-0">
                        <MonitorSmartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-text truncate">{t('pwa.install.bannerTitle', { server: serverName })}</p>
                        <p className="text-[11px] text-muted">{t('pwa.install.bannerSubtitle')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleInstallApp()}
                        className="shrink-0 rounded-xl bg-plex px-3 py-2 text-xs font-bold text-background"
                    >
                        {installPrompt ? t('pwa.install.button') : t('pwa.install.howTo')}
                    </button>
                    <button
                        type="button"
                        onClick={dismissInstallBanner}
                        className="shrink-0 p-1.5 rounded-lg text-muted hover:text-text"
                        aria-label={t('pwa.install.dismiss')}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Mobile Bottom Nav
                Chrome / PWA Chromium: plain fixed bottom:0 (do not change).
                Firefox mobile: dock bar to visualViewport bottom (Firefox-only hook). */}
            {(() => {
                const maxPrimary = MOBILE_NAV_PRIMARY_SLOTS;
                const showMore = normalizedNavOrder.length > maxPrimary;
                const primary = showMore ? normalizedNavOrder.slice(0, maxPrimary) : normalizedNavOrder;
                const navButtons = (
                    <>
                        {primary.map((key) => {
                            const item = navItemsConfig[key];
                            if (!item) return null;
                            const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                            const labelOverride = key === 'mediastack'
                                ? t('navigation.calendar')
                                : key === 'request'
                                    ? t('navigation.request')
                                    : key === 'media-player'
                                        ? t('navigation.mediaPlayerShort')
                                        : item.label;
                            return renderNavAction(key, { ...item, label: labelOverride }, { mobile: true, isCurrent, compactLabel: labelOverride, badgeCount: getNavBadgeCount(key) });
                        })}
                        {showMore && (
                            <button
                                type="button"
                                className={`relative flex flex-col items-center justify-center gap-1 h-full flex-1 min-w-[4.25rem] px-1 text-center text-[0.65rem] transition-colors bg-transparent border-0 ${
                                    mobileMoreOpen ? 'text-plex font-bold' : 'text-muted hover:text-text'
                                }`}
                                onClick={() => setMobileMoreOpen((open) => !open)}
                            >
                                <span className="relative shrink-0">
                                    <MoreHorizontal className="w-5 h-5" />
                                </span>
                                <span>{t('navigation.more')}</span>
                            </button>
                        )}
                    </>
                );
                const navInner = (
                    <div className="flex items-center justify-between w-full h-16 px-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
                        {navButtons}
                    </div>
                );

                if (firefoxMobileNav && typeof document !== 'undefined') {
                    // Portal to body so no ancestor creates a fixed containing block.
                    // Hook sets top from visualViewport; bleed fills any gesture-bar gap.
                    return ReactDOM.createPortal(
                        <div
                            ref={firefoxNavBarRef}
                            className="md:hidden fixed left-0 w-screen max-w-none nav-shell border-t z-[310] pb-[env(safe-area-inset-bottom,0px)]"
                            style={{ bottom: 0 }}
                        >
                            {navInner}
                            <div
                                className="absolute left-0 w-screen max-w-none nav-shell pointer-events-none"
                                style={{ top: '100%', height: 120, borderTop: 'none' }}
                                aria-hidden="true"
                            />
                        </div>,
                        document.body
                    );
                }

                return (
                    <div className="md:hidden fixed bottom-0 left-0 right-0 w-full nav-shell border-t z-[310] pb-[env(safe-area-inset-bottom)]">
                        {navInner}
                    </div>
                );
            })()}

            {/* Mobile More Drawer — above bottom nav (incl. Firefox body-portaled bar) */}
            {mobileMoreOpen && (
                <div className="md:hidden fixed inset-0 z-[320] bg-black/60 backdrop-blur-sm animate-fade-in flex flex-col justify-end" onClick={() => setMobileMoreOpen(false)}>
                    <div className="bg-card border-t border-border rounded-t-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-white/5">
                            <h3 className="font-bold text-text">{t('navigation.moreMenu')}</h3>
                            <button className="text-muted hover:text-text p-1 bg-white/5 rounded-full" onClick={() => setMobileMoreOpen(false)}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 grid grid-cols-4 gap-4">
                            {(() => {
                                const maxPrimary = MOBILE_NAV_PRIMARY_SLOTS;
                                const secondary = normalizedNavOrder.length > maxPrimary ? normalizedNavOrder.slice(maxPrimary) : [];
                                return secondary.map(key => {
                                    const item = navItemsConfig[key];
                                    if (!item) return null;
                                    const isCurrent = item.customTabId
                            ? isNavCurrent(key, item.route, item.customTabId)
                            : (item.route ? isNavCurrent(key, item.route) : false);
                                    const labelOverride = key === 'mediastack' ? t('navigation.calendar') : key === 'request' ? t('navigation.request') : item.label;
                                    const handleActivate = () => {
                                        setMobileMoreOpen(false);
                                        if (item.customTabId) {
                                            onNavigate('external', { path: `/external/${encodeURIComponent(item.customTabId)}` });
                                            return;
                                        }
                                        if (item.href) window.open(item.href, '_blank');
                                        else if (item.onClick) item.onClick({ preventDefault: () => {} });
                                        else if (item.route) onNavigate(item.route as any);
                                    };
                                    const badgeCount = getNavBadgeCount(key);
                                    const betaTitle = item.beta
                                        ? t(NAV_BETA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.betaNotice')
                                        : '';
                                    const alphaTitle = item.alpha
                                        ? t(NAV_ALPHA_NOTICE_KEYS[item.route] || 'mediaPlayerPage.betaNotice')
                                        : '';
                                    return (
                                        <button key={key} onClick={handleActivate} className="flex flex-col items-center gap-2 relative bg-transparent border-0">
                                            <div className={`relative w-[3.25rem] h-[3.25rem] rounded-full flex items-center justify-center transition-colors ${isCurrent ? 'bg-plex text-background shadow-[0_0_15px_rgba(229,160,13,0.35)]' : 'bg-background/50 text-text hover:bg-white/10 border border-white/5'}`}>
                                                <item.icon className="w-6 h-6" />
                                                {item.alpha ? (
                                                    <AlphaBadge
                                                        title={alphaTitle}
                                                        className="absolute -bottom-1.5 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[7px] leading-none"
                                                    />
                                                ) : item.beta ? (
                                                    <BetaBadge
                                                        title={betaTitle}
                                                        className="absolute -bottom-1.5 left-1/2 z-[1] -translate-x-1/2 px-1 py-0 text-[7px] leading-none"
                                                    />
                                                ) : null}
                                            </div>
                                            {badgeCount > 0 && (
                                                <span className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-plex text-background text-[10px] font-bold flex items-center justify-center leading-none">
                                                    {badgeCount > 9 ? '9+' : badgeCount}
                                                </span>
                                            )}
                                            <span className={`text-[10px] text-center w-full truncate px-1 ${isCurrent ? 'text-plex font-bold' : 'text-muted'}`}>{labelOverride}</span>
                                        </button>
                                    );
                                });
                            })()}
                            {!isInstalledApp && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMobileMoreOpen(false);
                                        void handleInstallApp();
                                    }}
                                    className="flex flex-col items-center gap-2 relative bg-transparent border-0"
                                >
                                    <div className="w-[3.25rem] h-[3.25rem] rounded-full flex items-center justify-center transition-colors bg-background/50 text-text hover:bg-white/10 border border-white/5">
                                        <MonitorSmartphone className="w-6 h-6" />
                                    </div>
                                    <span className="text-[10px] text-center w-full truncate px-1 text-muted">{t('pwa.install.button')}</span>
                                </button>
                            )}
                        </div>
                        <div className="pb-[calc(env(safe-area-inset-bottom)+1rem)]"></div>
                    </div>
                </div>
            )}
        </>
    );
};
