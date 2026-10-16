import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
const SettingsDashboard = lazy(() => import('./settings/SettingsDashboard').then(m => ({ default: m.SettingsDashboard })));
import { bindAppConfirm, bindAskConfirm, bindAppAlert, type AskConfirmOptions } from './shared/confirm';
import { apiFetch } from './shared/api';
import { getPublicOrigin, portalUrl, resolvePortalAssetUrl, stripBasePath } from './shared/basePath';
import { isStandalonePwa, syncExistingWebPushSubscription } from './shared/webPushSubscribe';
import { ConfirmModal } from './shared/ui';
import { Loader } from './shared/toast';
import { AppAmbientBackground } from './shared/theme';
import { WhatsNewModal } from './shared/WhatsNewModal';
import { SummaryDigestCard, openSummaryDigestFromUrl } from './shared/SummaryDigestCard';
import { DiscoverI18nProvider } from './discovery/i18n';
import { PortalJobsBanner } from './shared/PortalJobsBanner';
import { DEFAULT_NAV_ORDER, ensureCompleteNavOrder, filterNavOrder, isExpiredPortalAllowedRoute, resolveMemberNavOrder } from './shared/nav';
import { ExpiredAccessPage } from './expired/ExpiredAccessPage';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import {
    getLastSeenVersion,
    parseAppSemver,
    setLastSeenVersion,
    shouldShowReleaseNotes,
    type ReleaseNotes,
} from './shared/releaseNotes';

import { PLAYER_APP_BASE, PLAYER_EXIT_EVENT, PLAYER_NAVIGATE_EVENT } from './media-player/paths';
import { usePendingRequestCount } from './requests/usePendingRequestCount';
import { useWatchingCount } from './shared/useWatchingCount';
import { useDownloadCount } from './shared/useDownloadCount';
import { useAppDynamicTheme } from './shared/useAppDynamicTheme';
import { useOpenIssueCount } from './requests/useOpenIssueCount';
import { useSupportUnreadCount } from './support/useSupportUnreadCount';
import { useChatUnreadCount } from './chat/useChatUnreadCount';
import { useMediaAutomationActiveCount } from './media-automation/useMediaAutomationActiveCount';
const UpgraderDashboard = lazy(() => import('./upgrader/UpgraderDashboard').then(m => ({ default: m.UpgraderDashboard })));
const CollexionsDashboard = lazy(() => import('./collexions/CollexionsDashboard').then(m => ({ default: m.CollexionsDashboard })));
const SpotifySyncPage = lazy(() => import('./spotify-sync/SpotifySyncPage').then(m => ({ default: m.SpotifySyncPage })));
const MetadataFillPage = lazy(() => import('./metadata-fill/MetadataFillPage').then(m => ({ default: m.MetadataFillPage })));
const ScannerDashboard = lazy(() => import('./scanner/ScannerDashboard').then(m => ({ default: m.ScannerDashboard })));
const MediaAutomationDashboard = lazy(() => import('./media-automation/MediaAutomationDashboard').then(m => ({ default: m.MediaAutomationDashboard })));
const PosterSetsDashboard = lazy(() => import('./poster-sets/PosterSetsDashboard').then(m => ({ default: m.PosterSetsDashboard })));
const OverlaysDashboard = lazy(() => import('./overlays/OverlaysDashboard').then(m => ({ default: m.OverlaysDashboard })));
const EditionsDashboard = lazy(() => import('./editions/EditionsDashboard').then(m => ({ default: m.EditionsDashboard })));
const WatchSyncPage = lazy(() => import('./watch-sync/WatchSyncPage').then(m => ({ default: m.WatchSyncPage })));
const AchievementsDashboard = lazy(() => import('./achievements/AchievementsDashboard').then(m => ({ default: m.AchievementsDashboard })));
const SupportInbox = lazy(() => import('./support/SupportInbox').then(m => ({ default: m.SupportInbox })));
const ChatRoom = lazy(() => import('./chat/ChatRoom').then(m => ({ default: m.ChatRoom })));
const OpenAppletsHost = lazy(() => import('./custom/CustomExternalTabPage').then(m => ({ default: m.OpenAppletsHost })));
const PreferencesPage = lazy(() => import('./preferences/PreferencesPage').then(m => ({ default: m.PreferencesPage })));
const ProfilePage = lazy(() => import('./profile/ProfilePage').then(m => ({ default: m.ProfilePage })));
const DiscoveryDashboard = lazy(() => import('./discovery/DiscoveryDashboard').then(m => ({ default: m.DiscoveryDashboard })));
const MediaPlayerDashboard = lazy(() => import('./media-player').then(m => ({ default: m.MediaPlayerDashboard })));
import {
    updateFavicon,
    Login,
    PublicInviteClaim,
    StatusDashboard,
    LibraryDashboard,
    MaintenanceDashboard,
    LogsDashboard,
    MediaStackDashboard,
    DownloadStatusPage,
    AnalyticsDashboard,
    AdminDashboard,
    AboutDashboard,
    UserDashboard,
    Navigation,
} from './screens';
import { canAccessCustomNavTab } from './shared/customNavTabs';
import { closeOpenApplet, clearStoredOpenApplets, nextAppletAfterClose, readStoredOpenApplets, upsertOpenApplet, writeStoredOpenApplets, type OpenAppletSession } from './shared/openApplets';
import {
    ARR_OPEN_IN_PORTAL_EVENT,
    buildArrPortalEmbedHref,
    findMatchingArrEmbedTab,
    isSafeArrEmbedPath,
    readArrEmbedQuery,
    resolveArrEmbedPath,
} from '../lib/arr-portal-embed.js';

const getOpenAppletsAccountKey = (info: any) => (
    String(info?.account?.id ?? info?.session?.id ?? info?.session?.username ?? '')
);

export const MainApp: React.FC = () => {
    const [confirmState, setConfirmState] = useState<{
        isOpen: boolean;
        message: string;
        title?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        hideCancel?: boolean;
        danger?: boolean;
        onConfirm: () => void;
        onCancel: () => void;
    }>({ isOpen: false, message: '', onConfirm: () => { }, onCancel: () => { } });

    const [activeTheme, setActiveTheme] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('portal-theme') || 'plex';
            // Light theme is temporarily disabled — migrate saved preference.
            if (stored === 'light') {
                localStorage.setItem('portal-theme', 'plex');
                return 'plex';
            }
            return stored;
        }
        return 'plex';
    });

    useEffect(() => {
        const openConfirm = (
            message: string,
            onConfirm: () => void,
            onCancel: () => void = () => { },
            options: AskConfirmOptions & { hideCancel?: boolean } = {},
        ) => {
            setConfirmState({
                isOpen: true,
                message,
                title: options.title,
                confirmLabel: options.confirmLabel,
                cancelLabel: options.cancelLabel,
                hideCancel: options.hideCancel === true,
                danger: options.danger === true,
                onConfirm,
                onCancel,
            });
        };

        bindAppConfirm((message, onConfirm) => {
            openConfirm(message, onConfirm, () => { });
        });

        bindAskConfirm((message, options = {}) => new Promise<boolean>((resolve) => {
            openConfirm(
                message,
                () => resolve(true),
                () => resolve(false),
                options,
            );
        }));

        bindAppAlert((message, options = {}) => new Promise<void>((resolve) => {
            openConfirm(
                message,
                () => resolve(),
                () => resolve(),
                {
                    title: options.title || 'Notice',
                    confirmLabel: options.confirmLabel || 'OK',
                    hideCancel: true,
                },
            );
        }));
    }, []);


    const closeConfirm = () => setConfirmState((s) => ({ ...s, isOpen: false }));
    const handleConfirm = () => {
        confirmState.onConfirm();
        closeConfirm();
    };
    const handleCancel = () => {
        confirmState.onCancel();
        closeConfirm();
    };

    const [currentRoute, setCurrentRoute] = useState<'login' | 'admin' | 'user' | 'users' | 'status' | 'dashboard' | 'settings' | 'logs' | 'analytics' | 'achievements' | 'support' | 'chat' | 'downloads' | 'mediastack' | 'maintenance' | 'upgrader' | 'collexions' | 'spotify-sync' | 'metadata-fill' | 'scanner' | 'media-automation' | 'poster-sets' | 'overlays' | 'editions' | 'watch-sync' | 'requests' | 'discovery' | 'media-player' | 'about' | 'preferences' | 'profile' | 'invite' | 'onboarding' | 'external' | 'loading'>('loading');
    const [profilePath, setProfilePath] = useState(() => (
        typeof window !== 'undefined' ? stripBasePath(window.location.pathname) : '/profile'
    ));
    const [externalTabId, setExternalTabId] = useState<string | null>(null);
    const [externalEmbedPath, setExternalEmbedPath] = useState('');
    const [openApplets, setOpenApplets] = useState<OpenAppletSession[]>([]);
    const openAppletsHydratedRef = useRef(false);
    const [sessionInfo, setSessionInfo] = useState<any>(null);
    const sessionInfoRef = useRef<any>(null);
    sessionInfoRef.current = sessionInfo;
    // Default temporary access off so login never flashes the trial panel before public config arrives.
    const [publicConfig, setPublicConfig] = useState<any>({ allowTemporaryAccess: false });
    const [publicConfigWarning, setPublicConfigWarning] = useState<string | null>(null);
    const [releaseNotes, setReleaseNotes] = useState<ReleaseNotes | null>(null);
    const [showWhatsNew, setShowWhatsNew] = useState(false);
    const [summaryDigestId, setSummaryDigestId] = useState<string | null>(null);
    const whatsNewCheckedRef = useRef(false);

    const fetchPublicConfig = useCallback(async () => {
        try {
            const data = await apiFetch('/api/config/public');
            window.__USE_24_HOUR_CLOCK__ = data.use24HourClock === true;
            if (typeof data.basePath === 'string') {
                window.__BASE_PATH__ = data.basePath;
            }
            setPublicConfig(data);
            setPublicConfigWarning(null);

            if (data.appleTouchIconHref) {
                (window as any).__APPLE_TOUCH_ICON_HREF__ = data.appleTouchIconHref;
            }
            if (data.homeScreenIconRev) {
                (window as any).__HOME_SCREEN_ICON_REV__ = data.homeScreenIconRev;
            }
            updateFavicon(data.appleTouchIconHref || data.customFaviconUrl || data.customLogoUrl || 'application');
        } catch (e) {
            console.error('[portal] Failed to load public config:', e);
            setPublicConfigWarning('Portal branding settings could not be loaded. Defaults are being used.');
        }
    }, []);

    const lastBrandingTheme = useRef<string | null>(null);

    useEffect(() => {
        if (!publicConfig.brandingTheme) return;

        const resolveTheme = (value: string) => (value === 'light' ? 'plex' : value);

        if (lastBrandingTheme.current === null) {
            // First time config loads - respect user's localStorage choice if any
            const theme = resolveTheme(localStorage.getItem('portal-theme') || publicConfig.brandingTheme || 'plex');
            setActiveTheme(theme);
            lastBrandingTheme.current = publicConfig.brandingTheme;
        } else if (publicConfig.brandingTheme !== lastBrandingTheme.current) {
            // Default theme setting was changed (e.g. saved in Settings) - override local theme
            const theme = resolveTheme(publicConfig.brandingTheme);
            setActiveTheme(theme);
            localStorage.setItem('portal-theme', theme);
            lastBrandingTheme.current = publicConfig.brandingTheme;
        }
    }, [publicConfig.brandingTheme]);

    useEffect(() => {
        const theme = activeTheme === 'light' ? 'plex' : activeTheme;
        if (theme !== activeTheme) {
            setActiveTheme('plex');
            return;
        }
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('portal-theme', theme);
        if (theme !== 'dynamic') {
            document.documentElement.style.removeProperty('--color-plex');
            document.documentElement.style.removeProperty('--color-plex-hover');
        }
    }, [activeTheme]);

    useAppDynamicTheme(activeTheme, currentRoute, publicConfig);

    useEffect(() => {
        if (publicConfig?.useBrandedSkeleton !== false) {
            document.documentElement.classList.add('branded-skeleton');
        } else {
            document.documentElement.classList.remove('branded-skeleton');
        }
    }, [publicConfig?.useBrandedSkeleton]);

    useEffect(() => {
        window.scrollTo(0, 0);
        const container = document.getElementById('main-scroll-container');
        if (container) container.scrollTop = 0;
    }, [currentRoute]);

    useEffect(() => {
        fetchPublicConfig();
    }, [fetchPublicConfig]);

    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

        const isFirefox = /Firefox/i.test(navigator.userAgent || '');
        let cancelled = false;
        let refreshing = false;
        let hadController = !!navigator.serviceWorker.controller;

        const onControllerChange = () => {
            // Reload only after an *update*. The first claim on Android Chrome used to
            // reload mid-subscribe and leave the device locally subscribed but missing
            // from the server store.
            if (refreshing || cancelled) return;
            if (!hadController) {
                hadController = true;
                return;
            }
            refreshing = true;
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

        (async () => {
            try {
                const regs = await navigator.serviceWorker.getRegistrations();
                const permissionGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
                // Firefox Install used to no-op with a leftover SW. Keep that workaround
                // only until the PWA is installed or the user has already granted push.
                if (isFirefox && !isStandalonePwa() && !permissionGranted) {
                    await Promise.all(regs.map((reg) => reg.unregister()));
                    return;
                }

                if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    return;
                }
                if (cancelled) return;

                const reg = await navigator.serviceWorker.register(portalUrl('/service-worker.js'), {
                    scope: portalUrl('/'),
                    updateViaCache: 'none',
                });
                try {
                    await reg.update();
                } catch {
                    // ignore update probe failures
                }
            } catch {
                // ignore
            }
        })();

        return () => {
            cancelled = true;
            navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        };
    }, []);

    useEffect(() => {
        if (!sessionInfo) return;
        if (currentRoute === 'login' || currentRoute === 'loading' || currentRoute === 'invite') return;
        void syncExistingWebPushSubscription();
    }, [sessionInfo, currentRoute]);

    useEffect(() => {
        if (currentRoute === 'status' && !sessionInfo && publicConfig?.showPublicStatusMonitor === false) {
            setCurrentRoute('login');
            window.history.replaceState({}, '', portalUrl('/'));
        }
    }, [currentRoute, publicConfig?.showPublicStatusMonitor, sessionInfo]);

    useEffect(() => {
        const onPublicConfigUpdated = () => {
            fetchPublicConfig();
            apiFetch('/api/users/me')
                .then((data) => {
                    if (data?.session) setSessionInfo(data);
                })
                .catch(() => {});
        };
        window.addEventListener('portal-public-config-updated', onPublicConfigUpdated);
        return () => window.removeEventListener('portal-public-config-updated', onPublicConfigUpdated);
    }, [fetchPublicConfig]);

    useEffect(() => {
        if (!sessionInfo || !publicConfig?.appVersion) return;
        if (currentRoute === 'login' || currentRoute === 'loading' || currentRoute === 'invite') return;
        if (whatsNewCheckedRef.current) return;

        whatsNewCheckedRef.current = true;
        let cancelled = false;

        (async () => {
            try {
                const notes = await apiFetch('/api/release-notes') as ReleaseNotes;
                if (cancelled) return;
                if (shouldShowReleaseNotes(publicConfig.appVersion, notes, getLastSeenVersion())) {
                    setReleaseNotes(notes);
                    setShowWhatsNew(true);
                }
            } catch {
                // Release notes are optional — ignore fetch failures.
            }
        })();

        return () => { cancelled = true; };
    }, [sessionInfo, publicConfig?.appVersion, currentRoute]);

    const dismissWhatsNew = useCallback(() => {
        const semver = parseAppSemver(publicConfig?.appVersion);
        if (semver) setLastSeenVersion(semver);
        setShowWhatsNew(false);
    }, [publicConfig?.appVersion]);

    const setRoute = useCallback((route: 'login' | 'admin' | 'user' | 'users' | 'status' | 'dashboard' | 'settings' | 'logs' | 'analytics' | 'achievements' | 'support' | 'chat' | 'downloads' | 'mediastack' | 'maintenance' | 'upgrader' | 'collexions' | 'spotify-sync' | 'metadata-fill' | 'scanner' | 'media-automation' | 'poster-sets' | 'overlays' | 'editions' | 'watch-sync' | 'requests' | 'discovery' | 'media-player' | 'about' | 'preferences' | 'profile' | 'invite' | 'onboarding' | 'external' | 'loading', options?: { hash?: string; reviewId?: number; path?: string }) => {
        const session = sessionInfoRef.current;
        if (session?.needsOnboarding && !session?.session?.isAdmin && route !== 'login' && route !== 'loading' && route !== 'invite' && route !== 'onboarding') {
            route = 'onboarding';
            options = undefined;
        }
        if (session?.accessExpired && !session?.session?.isAdmin && route !== 'login' && route !== 'loading' && route !== 'invite' && route !== 'onboarding') {
            if (!isExpiredPortalAllowedRoute(route)) {
                route = 'user';
                options = undefined;
            }
        }
        if (route === 'logs') {
            setCurrentRoute('settings');
            window.history.pushState({}, '', portalUrl('/settings#logs'));
            return;
        }
        setCurrentRoute(route);
        if (route !== 'loading' && route !== 'invite') {
            let path = '/';
            if (route === 'admin') path = '/admin';
            if (route === 'users') path = '/users';
            if (route === 'user') path = '/portal';
            if (route === 'onboarding') path = '/onboarding';
            if (route === 'status') path = '/status';
            if (route === 'dashboard') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/dashboard') ? custom : '/dashboard';
            }
            if (route === 'settings') path = '/settings#branding';
            if (route === 'analytics') path = '/analytics';
            if (route === 'achievements') path = '/achievements';
            if (route === 'support') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/support') ? custom : '/support';
            }
            if (route === 'chat') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/chat') ? custom : '/chat';
            }
            if (route === 'downloads') path = '/downloads';
            if (route === 'mediastack') path = '/mediastack';
            if (route === 'maintenance') path = '/maintenance';
            if (route === 'upgrader') path = '/upgrader';
            if (route === 'collexions') path = '/collexions';
            if (route === 'spotify-sync') path = '/spotify-sync';
            if (route === 'metadata-fill') path = '/metadata-fill';
            if (route === 'scanner') path = '/scanner';
            if (route === 'media-automation') path = '/media-automation';
            if (route === 'poster-sets') path = '/poster-sets';
            if (route === 'overlays') path = '/overlays';
            if (route === 'editions') path = '/editions';
            if (route === 'watch-sync') path = '/watch-sync';
            if (route === 'requests') {
                // Legacy route: Review Queue now lives under Discover & Request.
                setCurrentRoute('discovery');
                path = options?.reviewId
                    ? `/discovery/queue?review=${options.reviewId}`
                    : '/discovery/queue';
                window.history.pushState({}, '', portalUrl(path));
                window.dispatchEvent(new Event('portal-discovery-navigate'));
                window.dispatchEvent(new CustomEvent('portal-requests-navigate', {
                    detail: { reviewId: options?.reviewId ?? null },
                }));
                return;
            }
            if (route === 'discovery') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/discovery') ? custom : '/discovery';
            }
            if (route === 'media-player') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith(PLAYER_APP_BASE) ? custom : PLAYER_APP_BASE;
            }
            if (route === 'about') path = '/about';
            if (route === 'preferences') path = '/preferences';
            if (route === 'profile') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/profile') ? custom : '/profile';
            }
            if (route === 'external') {
                const custom = String(options?.path || '').trim();
                path = custom.startsWith('/external') ? custom : '/external';
                const match = path.match(/^\/external\/([^/?#]+)/i);
                const nextId = match?.[1] ? decodeURIComponent(match[1]) : null;
                setExternalTabId(nextId);
                let nextEmbedPath = '';
                try {
                    const parsed = new URL(path, 'http://local.invalid');
                    nextEmbedPath = readArrEmbedQuery(parsed.search);
                    setExternalEmbedPath(nextEmbedPath);
                } catch {
                    setExternalEmbedPath('');
                }
                if (nextId) {
                    setOpenApplets((prev) => {
                        const existing = prev.find((session) => session.id === nextId);
                        const embed = nextEmbedPath || existing?.embedPath || '';
                        return upsertOpenApplet(prev, nextId, embed);
                    });
                }
            } else {
                setExternalTabId(null);
                setExternalEmbedPath('');
            }
            if (options?.hash) path += options.hash;
            window.history.pushState({}, '', portalUrl(path));
            if (route === 'profile') setProfilePath(stripBasePath(path.split('#')[0] || path));
            if (route === 'dashboard') {
                window.dispatchEvent(new Event('portal-dashboard-navigate'));
            }
            if (route === 'discovery') {
                window.dispatchEvent(new Event('portal-discovery-navigate'));
                if (String(path).includes('/discovery/queue')) {
                    let reviewId = options?.reviewId ?? null;
                    try {
                        const url = new URL(path, 'http://local.invalid');
                        const parsed = Number(url.searchParams.get('review'));
                        if (Number.isFinite(parsed) && parsed > 0) reviewId = parsed;
                    } catch {
                        /* ignore */
                    }
                    window.dispatchEvent(new CustomEvent('portal-requests-navigate', {
                        detail: { reviewId },
                    }));
                }
            }
            if (route === 'media-player') {
                window.dispatchEvent(new Event(PLAYER_NAVIGATE_EVENT));
            }
            if (route === 'support') {
                let ticketId = null;
                try {
                    const url = new URL(path, 'http://local.invalid');
                    const parsed = Number(url.searchParams.get('ticket'));
                    if (Number.isFinite(parsed) && parsed > 0) ticketId = parsed;
                } catch {
                    ticketId = null;
                }
                window.dispatchEvent(new CustomEvent('portal-support-navigate', {
                    detail: { ticketId },
                }));
            }
        }
    }, []);

    useEffect(() => {
        if (!sessionInfo) return;
        if (currentRoute === 'downloads') {
            if (sessionInfo.session?.isAdmin) return;
            if (sessionInfo.navFeatures?.downloads !== false) return;
            setRoute('user');
            return;
        }
        if (sessionInfo.accessExpired && !sessionInfo.session?.isAdmin && !isExpiredPortalAllowedRoute(currentRoute)) {
            setRoute('user');
        }
        if (sessionInfo.needsOnboarding && !sessionInfo.session?.isAdmin && currentRoute !== 'onboarding' && currentRoute !== 'login' && currentRoute !== 'loading' && currentRoute !== 'invite') {
            setRoute('onboarding');
        }
    }, [currentRoute, sessionInfo, setRoute]);

    const checkSession = useCallback(async () => {
        let path = stripBasePath(window.location.pathname).toLowerCase();
        if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
        if (path.startsWith('/invite/')) {
            setCurrentRoute('invite');
            return;
        }
        const params = new URLSearchParams(window.location.search);
        const loginError = params.get('loginError');
        if (loginError) {
            setCurrentRoute('login');
            return;
        }

        if (path.startsWith('/auth/')) {
            setCurrentRoute('login');
            return;
        }

        try {
            const data = await apiFetch('/api/users/me');
            setSessionInfo(data);
            try { sessionStorage.removeItem('smp.referral.ref'); } catch { /* ignore */ }
            if (data.serverName) document.title = `${data.serverName} Portal`;

            const expiredMember = !!data.accessExpired && !data.session?.isAdmin;
            const needsOnboarding = !!data.needsOnboarding && !data.session?.isAdmin;
            const allowExpiredPath = (routeId: string) => !expiredMember || isExpiredPortalAllowedRoute(routeId);
            const bounceExpiredHome = () => {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            };

            if (needsOnboarding) {
                window.history.replaceState({}, '', portalUrl('/onboarding'));
                setCurrentRoute('onboarding');
            }
            else if (path.startsWith('/status') && expiredMember) { bounceExpiredHome(); }
            else if (path.startsWith('/status')) setCurrentRoute('status');
            else if (path.startsWith('/dashboard') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/dashboard')) setCurrentRoute('dashboard');
            else if (path.startsWith('/settings') && data.session.isAdmin) setCurrentRoute('settings');
            else if (path === '/logs' && data.session.isAdmin) {
                window.history.replaceState({}, '', portalUrl('/settings#logs'));
                setCurrentRoute('settings');
            }
            else if (path.startsWith('/mediastack') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/mediastack')) setCurrentRoute('mediastack');
            else if (path.startsWith('/downloads') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/downloads')) setCurrentRoute('downloads');
            else if (path.startsWith('/maintenance') && data.session.isAdmin) setCurrentRoute('maintenance');
            else if (path.startsWith('/upgrader') && data.session.isAdmin) setCurrentRoute('upgrader');
            else if (
                path.startsWith('/collexions')
                && data.session.isAdmin
                && data.navFeatures?.collexions
                && String(data.mediaServerType || 'plex').toLowerCase() === 'plex'
            ) setCurrentRoute('collexions');
            else if (path.startsWith('/collexions')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (
                path.startsWith('/spotify-sync')
                && data.session.isAdmin
                && data.navFeatures?.spotifySync
                && String(data.mediaServerType || 'plex').toLowerCase() === 'plex'
            ) setCurrentRoute('spotify-sync');
            else if (path.startsWith('/spotify-sync')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (
                path.startsWith('/metadata-fill')
                && data.session.isAdmin
                && data.navFeatures?.metadataFill
                && String(data.mediaServerType || 'plex').toLowerCase() === 'plex'
            ) setCurrentRoute('metadata-fill');
            else if (path.startsWith('/metadata-fill')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/scanner') && data.session.isAdmin && data.navFeatures?.scanner) setCurrentRoute('scanner');
            else if (path.startsWith('/scanner')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/media-automation') && data.session.isAdmin && data.navFeatures?.mediaAutomation) setCurrentRoute('media-automation');
            else if (path.startsWith('/media-automation')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/poster-sets') && data.session.isAdmin && data.navFeatures?.posterSets) setCurrentRoute('poster-sets');
            else if (path.startsWith('/poster-sets')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/overlays') && data.session.isAdmin && data.navFeatures?.overlays) setCurrentRoute('overlays');
            else if (path.startsWith('/overlays')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/editions') && data.session.isAdmin && data.navFeatures?.editions) setCurrentRoute('editions');
            else if (path.startsWith('/editions')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/watch-sync') && data.session.isAdmin && data.navFeatures?.watchSync) setCurrentRoute('watch-sync');
            else if (path.startsWith('/watch-sync')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/requests') && data.session.isAdmin) {
                // Legacy URL — open Review Queue as a Discover tab.
                setCurrentRoute('discovery');
                const review = new URLSearchParams(window.location.search).get('review');
                const nextPath = review && Number(review) > 0
                    ? `/discovery/queue?review=${encodeURIComponent(review)}`
                    : '/discovery/queue';
                window.history.replaceState({}, '', portalUrl(nextPath));
            }
            else if (path.startsWith('/discovery') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/discovery')) setCurrentRoute('discovery');
            else if (path.startsWith(PLAYER_APP_BASE) && expiredMember) bounceExpiredHome();
            else if (path.startsWith(PLAYER_APP_BASE) && data.session.isAdmin && data.navFeatures?.mediaPlayer !== false) {
                setCurrentRoute('media-player');
            }
            else if (path.startsWith(PLAYER_APP_BASE)) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/about') && allowExpiredPath('about')) setCurrentRoute('about');
            else if (path.startsWith('/about')) bounceExpiredHome();
            else if (path.startsWith('/preferences') && allowExpiredPath('preferences')) setCurrentRoute('preferences');
            else if (path.startsWith('/preferences')) bounceExpiredHome();
            else if (path.startsWith('/profile') && allowExpiredPath('profile')) {
                setCurrentRoute('profile');
                setProfilePath(stripBasePath(window.location.pathname));
            }
            else if (path.startsWith('/profile')) bounceExpiredHome();
            else if (path.startsWith('/analytics') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/analytics')) setCurrentRoute('analytics');
            else if (path.startsWith('/achievements') && data.navFeatures?.achievements && !expiredMember) setCurrentRoute('achievements');
            else if (path.startsWith('/achievements')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/support') && data.navFeatures?.support !== false && allowExpiredPath('support')) setCurrentRoute('support');
            else if (path.startsWith('/support')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/chat') && data.navFeatures?.chat && allowExpiredPath('chat')) setCurrentRoute('chat');
            else if (path.startsWith('/chat')) {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
            else if (path.startsWith('/external/') && expiredMember) bounceExpiredHome();
            else if (path.startsWith('/external/')) {
                const match = path.match(/^\/external\/([^/?#]+)/i);
                const nextId = match?.[1] ? decodeURIComponent(match[1]) : null;
                const nextEmbedPath = readArrEmbedQuery(window.location.search);
                setExternalTabId(nextId);
                setExternalEmbedPath(nextEmbedPath);
                if (nextId) {
                    setOpenApplets((prev) => {
                        const existing = prev.find((session) => session.id === nextId);
                        const embed = nextEmbedPath || existing?.embedPath || '';
                        return upsertOpenApplet(prev, nextId, embed);
                    });
                }
                setCurrentRoute('external');
            }
            else if (path.startsWith('/admin') || path.startsWith('/users')) {
                if (data.session.isAdmin && !data.impersonation?.active) setCurrentRoute('users');
                else {
                    window.history.replaceState({}, '', portalUrl('/portal'));
                    setCurrentRoute('user');
                }
            }
            else if (path === '/portal') setCurrentRoute('user');
            else {
                window.history.replaceState({}, '', portalUrl('/portal'));
                setCurrentRoute('user');
            }
        } catch {
            if (path === '/status' && publicConfig?.showPublicStatusMonitor !== false) setCurrentRoute('status');
            else if (path === '/dashboard') setCurrentRoute('dashboard');
            else setCurrentRoute('login');
        }
    }, [publicConfig?.showPublicStatusMonitor]);

    useEffect(() => {
        // Initial session check
        checkSession();
    }, [checkSession]);

    useEffect(() => {
        const onPopState = () => {
            checkSession();
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [checkSession]);

    useEffect(() => {
        const onOpenProfile = (event: Event) => {
            const id = String((event as CustomEvent)?.detail?.accountId || (event as CustomEvent)?.detail?.username || '').trim();
            if (!id) return;
            setRoute('profile', { path: `/profile/${encodeURIComponent(id)}` });
        };
        window.addEventListener('portal-open-profile', onOpenProfile as EventListener);
        return () => window.removeEventListener('portal-open-profile', onOpenProfile as EventListener);
    }, [setRoute]);

    useEffect(() => {
        const onExitPlayer = () => {
            setRoute(sessionInfoRef.current?.session?.isAdmin ? 'dashboard' : 'user');
        };
        window.addEventListener(PLAYER_EXIT_EVENT, onExitPlayer);
        return () => window.removeEventListener(PLAYER_EXIT_EVENT, onExitPlayer);
    }, [setRoute]);

    useEffect(() => {
        const onOpenArrEmbed = (event: Event) => {
            if (!sessionInfo?.arrOpenInPortalEmbed || !sessionInfo?.session?.isAdmin) return;
            const detail = (event as CustomEvent)?.detail || {};
            const url = String(detail.url || '').trim();
            if (!url) return;
            const arrType = detail.arrType === 'sonarr' || detail.arrType === 'lidarr' ? detail.arrType : 'radarr';
            const tabs = Array.isArray(sessionInfo.customNavTabs) ? sessionInfo.customNavTabs : [];
            const tab = findMatchingArrEmbedTab(tabs, url, arrType);
            if (!tab || !canAccessCustomNavTab(tab, true)) return;
            const embedPath = resolveArrEmbedPath(tab.url, url);
            if (embedPath && !isSafeArrEmbedPath(embedPath)) return;
            event.preventDefault();
            setRoute('external', { path: buildArrPortalEmbedHref(tab.id, embedPath) });
        };
        window.addEventListener(ARR_OPEN_IN_PORTAL_EVENT, onOpenArrEmbed as EventListener);
        return () => window.removeEventListener(ARR_OPEN_IN_PORTAL_EVENT, onOpenArrEmbed as EventListener);
    }, [sessionInfo, setRoute]);

    useEffect(() => {
        if (!sessionInfo?.session?.isAdmin) {
            setSummaryDigestId(null);
            return;
        }
        const syncFromUrl = () => {
            const id = openSummaryDigestFromUrl();
            setSummaryDigestId(id);
        };
        syncFromUrl();
        const onOpenSummary = (event: Event) => {
            const digestId = String((event as CustomEvent)?.detail?.digestId || 'latest').trim() || 'latest';
            setSummaryDigestId(digestId);
        };
        window.addEventListener('portal-summary-open', onOpenSummary as EventListener);
        window.addEventListener('popstate', syncFromUrl);
        return () => {
            window.removeEventListener('portal-summary-open', onOpenSummary as EventListener);
            window.removeEventListener('popstate', syncFromUrl);
        };
    }, [sessionInfo?.session?.isAdmin]);

    const handleLogout = async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        if (sessionInfo) clearStoredOpenApplets(getOpenAppletsAccountKey(sessionInfo));
        openAppletsHydratedRef.current = false;
        openAppletsPersistReadyRef.current = false;
        openAppletsAccountRef.current = '';
        setSessionInfo(null);
        setOpenApplets([]);
        setRoute('login');
    };

    const isAdminSession = !!sessionInfo?.session?.isAdmin;
    const openAppletsAccountRef = useRef('');
    const openAppletsPersistReadyRef = useRef(false);

    useEffect(() => {
        if (!sessionInfo) return;
        const accountKey = getOpenAppletsAccountKey(sessionInfo);
        if (openAppletsAccountRef.current === accountKey && openAppletsHydratedRef.current) return;
        openAppletsAccountRef.current = accountKey;
        openAppletsHydratedRef.current = true;
        openAppletsPersistReadyRef.current = false;
        const stored = readStoredOpenApplets(accountKey);
        const tabs = Array.isArray(sessionInfo.customNavTabs) ? sessionInfo.customNavTabs : [];
        if (stored.length) {
            setOpenApplets((prev) => {
                const merged = [...stored];
                for (const session of prev) {
                    if (!merged.some((entry) => entry.id === session.id)) merged.push(session);
                }
                return merged.filter((session) => {
                    const tab = tabs.find((entry) => String(entry.id) === session.id);
                    return tab && canAccessCustomNavTab(tab, isAdminSession) && tab.openMode === 'embed';
                });
            });
        } else {
            openAppletsPersistReadyRef.current = true;
        }
    }, [sessionInfo, isAdminSession]);

    useEffect(() => {
        if (!openAppletsHydratedRef.current) return;
        openAppletsPersistReadyRef.current = true;
    }, [openApplets]);

    useEffect(() => {
        if (!sessionInfo || !openAppletsPersistReadyRef.current) return;
        writeStoredOpenApplets(getOpenAppletsAccountKey(sessionInfo), openApplets);
    }, [openApplets, sessionInfo]);

    const appletNavOrder = useMemo(() => {
        if (!sessionInfo) return [...DEFAULT_NAV_ORDER];
        const customNavTabs = Array.isArray(sessionInfo.customNavTabs) ? sessionInfo.customNavTabs : [];
        const order = isAdminSession
            ? ensureCompleteNavOrder(sessionInfo.navOrder)
            : resolveMemberNavOrder(sessionInfo.memberNavOrder, sessionInfo.navOrder, customNavTabs);
        const hiddenKeys = isAdminSession ? sessionInfo.navHiddenKeys : sessionInfo.memberNavHiddenKeys;
        return filterNavOrder(order, {
            isAdmin: isAdminSession,
            features: sessionInfo.navFeatures,
            hiddenKeys,
            customTabs: customNavTabs,
            accessExpired: !!sessionInfo.accessExpired,
        });
    }, [sessionInfo, isAdminSession]);

    const buildOpenAppletPath = useCallback((session: OpenAppletSession) => (
        buildArrPortalEmbedHref(session.id, session.embedPath)
    ), []);

    const handleActivateApplet = useCallback((session: OpenAppletSession) => {
        const path = buildOpenAppletPath(session);
        if (currentRoute === 'external' && externalTabId === session.id) return;
        if (currentRoute === 'external') {
            setExternalTabId(session.id);
            setExternalEmbedPath(session.embedPath || '');
            window.history.pushState({}, '', portalUrl(path));
            return;
        }
        setRoute('external', { path });
    }, [buildOpenAppletPath, currentRoute, externalTabId, setRoute]);

    const handleCloseApplet = useCallback((id: string) => {
        const closingActive = currentRoute === 'external' && externalTabId === id;
        if (closingActive) {
            const fallback = nextAppletAfterClose(openApplets, id);
            setOpenApplets(closeOpenApplet(openApplets, id));
            if (fallback) {
                setRoute('external', { path: buildOpenAppletPath(fallback) });
            } else {
                setRoute('dashboard');
            }
            return;
        }
        setOpenApplets((prev) => closeOpenApplet(prev, id));
    }, [buildOpenAppletPath, currentRoute, externalTabId, openApplets, setRoute]);

    const handleCloseAllApplets = useCallback(() => {
        if (!openApplets.length) return;
        if (sessionInfo) clearStoredOpenApplets(getOpenAppletsAccountKey(sessionInfo));
        setOpenApplets([]);
        if (currentRoute === 'external') {
            setRoute('dashboard');
        }
    }, [currentRoute, openApplets.length, sessionInfo, setRoute]);

    const handleStopImpersonation = async () => {
        try {
            await apiFetch('/api/admin/stop-impersonation', { method: 'POST' });
            await checkSession();
            setRoute('users');
        } catch (e) {
            console.error('Failed to stop impersonation', e);
        }
    };

    const handleViewAsUser = async (userId: string) => {
        try {
            await apiFetch(`/api/admin/impersonate/${encodeURIComponent(userId)}`, { method: 'POST' });
            await checkSession();
            setRoute('user');
        } catch (e) {
            console.error('Failed to impersonate user', e);
            throw e;
        }
    };

    const requestsQueueEnabled = !!sessionInfo?.session?.isAdmin && !!sessionInfo?.navFeatures?.requestsQueue;
    const { pendingCount: pendingRequestCount, refresh: refreshPendingRequestCount } = usePendingRequestCount(requestsQueueEnabled);
    const showDashboardWatchingBadge = publicConfig?.showDashboardWatchingBadge === true;
    const dashboardWatchingBadgePollSeconds = Number(publicConfig?.dashboardWatchingBadgePollSeconds) || 15;
    const { watchingCount } = useWatchingCount(showDashboardWatchingBadge, dashboardWatchingBadgePollSeconds);
    const downloadsNavEnabled = !!sessionInfo && (
        !!sessionInfo?.session?.isAdmin || sessionInfo?.navFeatures?.downloads !== false
    );
    const { downloadCount } = useDownloadCount(downloadsNavEnabled, 15);
    const mediaAutomationNavEnabled = !!sessionInfo?.session?.isAdmin && !!sessionInfo?.navFeatures?.mediaAutomation;
    const { activeCount: mediaAutomationActiveCount } = useMediaAutomationActiveCount(mediaAutomationNavEnabled, 15);
    const { openCount: openIssueCount, refresh: refreshOpenIssueCount } = useOpenIssueCount(requestsQueueEnabled);
    const supportEnabled = !!sessionInfo && sessionInfo?.navFeatures?.support !== false;
    const { unread: supportUnreadCount, refresh: refreshSupportUnread } = useSupportUnreadCount(supportEnabled);
    const chatEnabled = !!sessionInfo && !!sessionInfo?.navFeatures?.chat;
    const { unread: chatUnreadCount, refresh: refreshChatUnread } = useChatUnreadCount(chatEnabled);
    const queueBadgeCount = pendingRequestCount + openIssueCount;
    const refreshQueueCounts = useCallback(() => {
        refreshPendingRequestCount();
        refreshOpenIssueCount();
    }, [refreshPendingRequestCount, refreshOpenIssueCount]);

    if (currentRoute === 'loading') return <Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />;
    if (currentRoute === 'login') {
        const initialLoginError = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('loginError')
            : null;
        return <Login onLoginSuccess={checkSession} publicConfig={publicConfig} publicConfigWarning={publicConfigWarning} initialError={initialLoginError || undefined} />;
    }

    const isAdmin = !!sessionInfo?.session?.isAdmin;
    const isImpersonating = !!sessionInfo?.impersonation?.active;

    const isPublicStatus = currentRoute === 'status' && !sessionInfo;
    const isPublicInvite = currentRoute === 'invite';
    const isOnboardingView = currentRoute === 'onboarding';
    const isPublicView = isPublicStatus || isPublicInvite || isOnboardingView;
    const isMediaPlayerView = currentRoute === 'media-player';

    const renderView = () => {
        if (currentRoute === 'invite') {
            const code = stripBasePath(window.location.pathname).split('/')[2];
            return <PublicInviteClaim code={code} />;
        }
        if (currentRoute === 'onboarding') {
            return (
                <OnboardingWizard
                    onComplete={async () => {
                        await checkSession();
                        setRoute('user');
                    }}
                />
            );
        }
        if (currentRoute === 'status') return <StatusDashboard onBack={() => isPublicStatus ? setRoute('login') : setRoute('user')} isAdmin={isAdmin} isPublic={isPublicStatus} />;
        if (currentRoute === 'dashboard') return <LibraryDashboard onBack={() => setRoute('user')} isAdmin={isAdmin} publicConfig={publicConfig} mediaServerType={sessionInfo?.mediaServerType} onViewAnalytics={(hash) => setRoute('analytics', { hash })} onNavigate={setRoute as any} />;
        if (currentRoute === 'settings' && isAdmin) return <SettingsDashboard />;
        if (currentRoute === 'maintenance' && isAdmin) return <MaintenanceDashboard />;
        if (currentRoute === 'upgrader' && isAdmin) return <UpgraderDashboard />;
        if (
            currentRoute === 'collexions'
            && isAdmin
            && sessionInfo?.navFeatures?.collexions
            && String(sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex').toLowerCase() === 'plex'
        ) return <CollexionsDashboard />;
        if (
            currentRoute === 'spotify-sync'
            && isAdmin
            && sessionInfo?.navFeatures?.spotifySync
            && String(sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex').toLowerCase() === 'plex'
        ) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <SpotifySyncPage />
                </Suspense>
            );
        }
        if (
            currentRoute === 'metadata-fill'
            && isAdmin
            && sessionInfo?.navFeatures?.metadataFill
            && String(sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex').toLowerCase() === 'plex'
        ) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <MetadataFillPage />
                </Suspense>
            );
        }
        if (currentRoute === 'scanner' && isAdmin && sessionInfo?.navFeatures?.scanner) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <ScannerDashboard />
                </Suspense>
            );
        }
        if (currentRoute === 'media-automation' && isAdmin && sessionInfo?.navFeatures?.mediaAutomation) return <MediaAutomationDashboard />;
        if (currentRoute === 'poster-sets' && isAdmin && sessionInfo?.navFeatures?.posterSets) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <PosterSetsDashboard />
                </Suspense>
            );
        }
        if (currentRoute === 'overlays' && isAdmin && sessionInfo?.navFeatures?.overlays) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <OverlaysDashboard />
                </Suspense>
            );
        }
        if (currentRoute === 'editions' && isAdmin && sessionInfo?.navFeatures?.editions) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <EditionsDashboard />
                </Suspense>
            );
        }
        if (currentRoute === 'watch-sync' && isAdmin && sessionInfo?.navFeatures?.watchSync) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <WatchSyncPage />
                </Suspense>
            );
        }
        if (currentRoute === 'requests' && isAdmin) {
            // Keep legacy route id working by rendering Discover on the queue tab.
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <DiscoveryDashboard
                        onItemClick={(item) => console.log('Item', item)}
                        mediaServerType={sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex'}
                        isAdmin={isAdmin}
                        showReviewQueue={requestsQueueEnabled}
                        queueBadgeCount={queueBadgeCount}
                        openIssueCount={openIssueCount}
                        onQueueCountsChange={refreshQueueCounts}
                    />
                </Suspense>
            );
        }
        if (currentRoute === 'discovery') {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <DiscoveryDashboard
                        onItemClick={(item) => console.log('Item', item)}
                        mediaServerType={sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex'}
                        isAdmin={isAdmin}
                        showReviewQueue={requestsQueueEnabled}
                        queueBadgeCount={queueBadgeCount}
                        openIssueCount={openIssueCount}
                        onQueueCountsChange={refreshQueueCounts}
                    />
                </Suspense>
            );
        }
        if (currentRoute === 'media-player' && isAdmin && sessionInfo?.navFeatures?.mediaPlayer !== false) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <MediaPlayerDashboard />
                </Suspense>
            );
        }
        if (currentRoute === 'logs' && isAdmin) return <LogsDashboard onLogout={handleLogout} />;
        if (currentRoute === 'mediastack') return <MediaStackDashboard isAdmin={isAdmin} />;
        if (currentRoute === 'downloads') return <DownloadStatusPage isAdmin={isAdmin} />;
        if (currentRoute === 'analytics') return <AnalyticsDashboard isAdmin={isAdmin} sessionInfo={sessionInfo} onNavigate={setRoute as any} />;
        if (currentRoute === 'achievements' && sessionInfo?.navFeatures?.achievements) {
            return <AchievementsDashboard sessionInfo={sessionInfo} onNavigate={setRoute as any} />;
        }
        if (currentRoute === 'support' && sessionInfo?.navFeatures?.support !== false) {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <SupportInbox sessionInfo={sessionInfo} onCountsChange={refreshSupportUnread} />
                </Suspense>
            );
        }
        if (currentRoute === 'chat' && sessionInfo?.navFeatures?.chat) {
            const roomId = typeof window !== 'undefined'
                ? new URLSearchParams(window.location.search).get('room')
                : null;
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <ChatRoom
                        sessionInfo={sessionInfo}
                        onCountsChange={refreshChatUnread}
                        initialRoomId={roomId}
                    />
                </Suspense>
            );
        }
        if (currentRoute === 'about') return <AboutDashboard appVersion={publicConfig?.appVersion} mediaServerType={sessionInfo?.mediaServerType || publicConfig?.mediaServerType} />;
        if (currentRoute === 'preferences') {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <PreferencesPage sessionInfo={sessionInfo} refreshSession={checkSession} publicConfig={publicConfig} />
                </Suspense>
            );
        }
        if (currentRoute === 'profile') {
            return (
                <Suspense fallback={<Loader isLoading={true} isCinematic={!!publicConfig?.useCinematicLoading} />}>
                    <ProfilePage
                        key={profilePath}
                        locationPath={profilePath}
                        sessionInfo={sessionInfo}
                        onNavigate={setRoute as any}
                        onLogout={handleLogout}
                        onViewAsUser={handleViewAsUser}
                    />
                </Suspense>
            );
        }
        if (currentRoute === 'admin' || currentRoute === 'users') return <AdminDashboard onLogout={handleLogout} onViewUserPortal={() => setRoute('user')} onViewStatus={() => setRoute('status')} onViewDashboard={() => setRoute('dashboard')} onViewAsUser={handleViewAsUser} onViewProfile={(userId) => setRoute('profile', { path: `/profile/${encodeURIComponent(userId)}` })} />;
        if (sessionInfo?.accessExpired && !sessionInfo?.session?.isAdmin) {
            return (
                <ExpiredAccessPage
                    sessionInfo={sessionInfo}
                    publicConfig={publicConfig}
                    onNavigate={(route) => setRoute(route as any)}
                    onLogout={handleLogout}
                />
            );
        }
        return <UserDashboard sessionInfo={sessionInfo} publicConfig={publicConfig} onLogout={handleLogout} refreshSession={checkSession} onViewAdmin={() => setRoute('users')} onViewStatus={() => setRoute('status')} onViewDashboard={() => setRoute('dashboard')} onViewSettings={() => setRoute('settings')} onViewLogs={() => setRoute('logs')} onViewCollexions={() => setRoute('collexions')} onViewScanner={() => setRoute('scanner')} onViewSpotifySync={() => setRoute('spotify-sync')} onViewMediaAutomation={() => setRoute('media-automation')} onViewRequests={(reviewId) => setRoute('requests', reviewId ? { reviewId } : undefined)} onPendingRequestsChange={refreshPendingRequestCount} onNavigate={setRoute as any} />;
    };

    return (
        <DiscoverI18nProvider
            accountId={sessionInfo?.account?.id}
            accountLocale={sessionInfo?.account?.uiLocale}
        >
        <div className={`relative flex w-full min-h-screen md:h-dvh md:overflow-hidden ${isMediaPlayerView ? 'h-dvh overflow-hidden' : ''}`}>
            <AppAmbientBackground backgroundImageUrl={publicConfig?.backgroundImageUrl} />
            <ConfirmModal
                isOpen={confirmState.isOpen}
                message={confirmState.message}
                title={confirmState.title}
                confirmLabel={confirmState.confirmLabel}
                cancelLabel={confirmState.cancelLabel}
                hideCancel={confirmState.hideCancel}
                danger={confirmState.danger}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
            {showWhatsNew && releaseNotes && (
                <WhatsNewModal
                    notes={releaseNotes}
                    appVersion={publicConfig?.appVersion}
                    onDismiss={dismissWhatsNew}
                />
            )}
            {summaryDigestId && isAdmin && (
                <SummaryDigestCard
                    digestId={summaryDigestId}
                    onClose={() => setSummaryDigestId(null)}
                />
            )}
            {!isPublicView && !isMediaPlayerView && <Navigation currentRoute={currentRoute} onNavigate={setRoute as any} onLogout={handleLogout} onSessionRefresh={checkSession} isAdmin={isAdmin} serverName={sessionInfo?.serverName || 'StreamPilot'} adminThumb={sessionInfo?.adminThumb} customLogoUrl={publicConfig?.customLogoUrl} requestUrl={sessionInfo?.requestUrl || 'https://yourdomain.com'} navOrder={sessionInfo?.navOrder || [...DEFAULT_NAV_ORDER]} navHiddenKeys={sessionInfo?.navHiddenKeys} memberNavOrder={sessionInfo?.memberNavOrder} memberNavHiddenKeys={sessionInfo?.memberNavHiddenKeys} navFeatures={sessionInfo?.navFeatures} appVersion={publicConfig.appVersion} activeTheme={activeTheme} setActiveTheme={setActiveTheme} pendingRequestCount={queueBadgeCount} supportUnreadCount={supportUnreadCount} chatUnreadCount={chatUnreadCount} watchingCount={watchingCount} downloadCount={downloadCount} mediaAutomationActiveCount={mediaAutomationActiveCount} showDashboardWatchingBadge={showDashboardWatchingBadge} sessionInfo={sessionInfo} mediaServerType={sessionInfo?.mediaServerType || publicConfig?.mediaServerType || 'plex'} sidebarIdentityPosition={publicConfig?.sidebarIdentityPosition || 'bottom'} externalTabId={externalTabId} openApplets={openApplets} onCloseApplet={handleCloseApplet} />}
            <div id="main-scroll-container" className={`relative z-10 flex-1 min-w-0 min-h-0 flex flex-col items-center overflow-x-clip custom-scrollbar ${isMediaPlayerView ? 'px-0 pb-0 overflow-hidden' : `px-4 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:px-8 md:pb-8 ${currentRoute === 'external' ? 'overflow-hidden md:pb-4' : 'md:overflow-y-auto'} ${isPublicView ? '!pb-8' : ''}`}`}>
                {isImpersonating && (
                    <div className={`w-full max-w-[100%] ${isMediaPlayerView ? 'pt-2' : 'pt-[calc(5rem+env(safe-area-inset-top,0px))]'} md:pt-0 md:sticky md:top-0 md:z-30`}>
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-100 shadow-lg backdrop-blur-md">
                            <p className="text-sm font-medium">
                                Viewing portal as <span className="font-bold text-white">{sessionInfo?.impersonation?.targetUsername || sessionInfo?.session?.username}</span>
                            </p>
                            <button
                                type="button"
                                onClick={handleStopImpersonation}
                                className="px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-50 text-sm font-bold hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                            >
                                Exit impersonation
                            </button>
                        </div>
                    </div>
                )}
                <div className={`w-full min-w-0 max-w-[100%] flex flex-col ${
                    isMediaPlayerView
                        ? `flex-1 min-h-0 h-full ${isImpersonating ? 'pt-3' : 'pt-0'}`
                        : isImpersonating
                            ? 'shrink-0 pt-3 md:pt-4'
                            : currentRoute === 'external'
                                ? 'flex-1 min-h-0 pt-[calc(5rem+env(safe-area-inset-top,0px))] md:pt-4'
                                : 'shrink-0 pt-[calc(5rem+env(safe-area-inset-top,0px))] md:pt-8'
                }`}>
                    <Suspense fallback={<div className="flex w-full items-center justify-center pt-20"><Loader isLoading={true} isCinematic={false} /></div>}>
                        {(openApplets.length > 0 || currentRoute === 'external') ? (
                            <OpenAppletsHost
                                sessions={openApplets}
                                activeId={externalTabId}
                                visible={currentRoute === 'external'}
                                customNavTabs={sessionInfo?.customNavTabs || []}
                                navOrder={appletNavOrder}
                                isAdmin={isAdmin}
                                onActivate={handleActivateApplet}
                                onClose={handleCloseApplet}
                                onCloseAll={handleCloseAllApplets}
                            />
                        ) : null}
                        {currentRoute !== 'external' ? (
                            <div className={isMediaPlayerView ? 'flex h-full min-h-0 flex-col' : ''}>
                                {isAdmin && !isPublicView && !isMediaPlayerView ? (
                                    <PortalJobsBanner
                                        currentRoute={currentRoute}
                                        collexionsEnabled={!!sessionInfo?.navFeatures?.collexions}
                                        onNavigate={(route) => setRoute(route as any)}
                                    />
                                ) : null}
                                <div className={isMediaPlayerView ? 'flex min-h-0 flex-1 flex-col' : ''}>
                                    {renderView()}
                                </div>
                            </div>
                        ) : null}
                    </Suspense>
                </div>

                {/* Mobile Bottom Version */}
                {!isPublicView && !isMediaPlayerView && publicConfig?.appVersion && currentRoute !== 'external' && (
                    <div className="md:hidden mt-auto pt-12 pb-4 w-full text-center text-[10px] text-white/30 font-mono tracking-widest pointer-events-none">
                        {publicConfig.appVersion}
                    </div>
                )}
            </div>
        </div>
        </DiscoverI18nProvider>
    );
};
