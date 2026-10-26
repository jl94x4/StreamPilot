import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscoverI18nProvider } from '../discovery/i18n';
import { MediaPlayerDashboard } from '../media-player/MediaPlayerDashboard';
import { prefetchMediaPlayerHome } from '../media-player/api';
import { PLAYER_APP_BASE, PLAYER_LOGOUT_EVENT } from '../media-player/paths';
import { apiFetch } from '../shared/api';
import { PlexHomeSwitchModal, type PlexHomeProfile } from '../shared/PlexHomeSwitchModal';
import { lazyScreen } from '../media-player/lazyScreen';
import { applyPerfFlags, PlayerPerfOverlay } from '../media-player/PlayerPerfOverlay';
import { PlexClientAuthScreen, PlexClientBootSplash } from './AuthScreen';
import { firstRunSetupPending, markFirstRunSetup, PlexClientFirstRunSetup } from './FirstRunSetup';
import { hydratePlexClientAuthStorage } from './authPersistence';
import { withBootTimeout } from './bootTimeout';
import {
    bootstrapPlexClientConfig,
    clearPlexClientSession,
    detectAndApplyTvUi,
    getSessionToken,
    isAndroidTvUi,
    isPlexDirectMode,
} from './config';
import { installMediaDownloadsBridge } from './mediaDownloads';
import { installNativeMediaPlayerBridge } from './nativePlayer';
import { useTvRemote } from './useTvRemote';

// Its notes are ~45KB; it decides to show after start-up, so it loads alongside, not before.
// Diagnostics switches (Settings → Display) apply before Home first paints.
applyPerfFlags();

const ApkWhatsNew = lazyScreen(() => import('./ApkWhatsNew').then((m) => m.ApkWhatsNew));

const ensurePlayerRoute = () => {
    try {
        const path = window.location.pathname || '/';
        if (path === '/' || path === '') {
            window.history.replaceState({}, '', PLAYER_APP_BASE);
        }
    } catch {
        /* ignore */
    }
};

const PlexClientApp: React.FC = () => {
    const [ready, setReady] = useState(false);
    const [authed, setAuthed] = useState(false);
    const [checking, setChecking] = useState(true);
    const [tvReady, setTvReady] = useState(false);
    const [homePickerDone, setHomePickerDone] = useState(false);
    const [setupPending, setSetupPending] = useState(() => firstRunSetupPending());
    const [homePickerUsers, setHomePickerUsers] = useState<PlexHomeProfile[]>([]);
    const [homePickerCurrentId, setHomePickerCurrentId] = useState<string | null>(null);
    const [homePickerBusy, setHomePickerBusy] = useState(false);
    const [homePickerError, setHomePickerError] = useState('');

    useTvRemote(ready && tvReady);

    useEffect(() => {
        let cancelled = false;
        const boot = async () => {
            await withBootTimeout(hydratePlexClientAuthStorage(), 2000);
            bootstrapPlexClientConfig();
            const tv = await withBootTimeout(detectAndApplyTvUi(), 3000);
            if (cancelled) return;
            setTvReady(tv || isAndroidTvUi());
            installNativeMediaPlayerBridge();
            installMediaDownloadsBridge();
            setReady(true);
            const token = getSessionToken();
            if (!token) {
                setChecking(false);
                return;
            }
            try {
                const data = await withBootTimeout(
                    apiFetch('/api/auth/session'),
                    12_000,
                );
                if (cancelled) return;
                if (data?.authenticated) {
                    ensurePlayerRoute();
                    prefetchMediaPlayerHome();
                    setAuthed(true);
                } else if (data === undefined) {
                    // Portal slow / unreachable — do not trap on the splash screen.
                    ensurePlayerRoute();
                    prefetchMediaPlayerHome();
                    setAuthed(true);
                } else {
                    clearPlexClientSession();
                }
            } catch {
                if (!cancelled && getSessionToken()) {
                    ensurePlayerRoute();
                    prefetchMediaPlayerHome();
                    setAuthed(true);
                }
            } finally {
                if (!cancelled) setChecking(false);
            }
        };
        void boot();
        return () => { cancelled = true; };
    }, []);

    const onAuthenticated = useCallback(() => {
        ensurePlayerRoute();
        // Fresh sign-in: choose servers and Home libraries before Home (direct Plex only).
        if (isPlexDirectMode()) {
            markFirstRunSetup(true);
            setSetupPending(true);
        }
        prefetchMediaPlayerHome();
        // Sign-in already picked (and PIN-checked) the profile. Without this the TV's
        // launch picker opened straight after and asked for the same PIN again.
        setHomePickerDone(true);
        setAuthed(true);
    }, []);

    useEffect(() => {
        if (!authed || homePickerDone) return;
        const isTv = isAndroidTvUi() || document.documentElement?.dataset?.tv === '1';
        if (!isTv) {
            setHomePickerDone(true);
            return;
        }
        let cancelled = false;
        const check = async () => {
            try {
                const data = await apiFetch('/api/auth/plex/home-profiles');
                if (cancelled) return;
                const users: PlexHomeProfile[] = Array.isArray(data?.users)
                    ? data.users.filter((u: any) => u?.id)
                    : [];
                if (!data?.available || users.length <= 1) {
                    setHomePickerDone(true);
                    return;
                }
                const currentId = data.currentUserId || null;
                const rememberedId = data.rememberUserId || null;
                if (rememberedId && users.some((u) => u.id === rememberedId || u.uuid === rememberedId)) {
                    setHomePickerDone(true);
                    return;
                }
                setHomePickerUsers(users);
                setHomePickerCurrentId(currentId);
            } catch {
                if (!cancelled) setHomePickerDone(true);
            }
        };
        void check();
        return () => { cancelled = true; };
    }, [authed, homePickerDone]);

    const handleHomePickerSelect = useCallback(async (user: PlexHomeProfile, pin: string | undefined) => {
        setHomePickerBusy(true);
        setHomePickerError('');
        try {
            await apiFetch('/api/auth/plex/home-profiles/switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    remember: true,
                    ...(pin ? { pin } : {}),
                }),
            });
            setHomePickerDone(true);
            prefetchMediaPlayerHome();
        } catch (err: any) {
            setHomePickerError(err?.message || 'Could not switch profile');
            setHomePickerBusy(false);
        }
    }, []);

    // Live Home: listen to the Plex servers' change feed while signed in (direct mode only;
    // a portal session gets its data through the portal).
    useEffect(() => {
        if (!authed || !homePickerDone || !isPlexDirectMode()) return undefined;
        let stop: (() => void) | null = null;
        let cancelled = false;
        void import('./plexDirect').then(({ startPlexLiveUpdates }) => {
            if (cancelled) return;
            stop = startPlexLiveUpdates();
        }).catch(() => undefined);
        return () => {
            cancelled = true;
            stop?.();
        };
    }, [authed, homePickerDone]);

    useEffect(() => {
        const onLogout = () => {
            void apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
            clearPlexClientSession();
            setAuthed(false);
            setHomePickerDone(false);
            setHomePickerUsers([]);
            setHomePickerError('');
        };
        window.addEventListener(PLAYER_LOGOUT_EVENT, onLogout);
        return () => window.removeEventListener(PLAYER_LOGOUT_EVENT, onLogout);
    }, []);

    if (!ready || checking) {
        return <PlexClientBootSplash />;
    }

    if (!authed) {
        return <PlexClientAuthScreen onAuthenticated={onAuthenticated} />;
    }

    if (!homePickerDone && homePickerUsers.length > 1) {
        return (
            <div className="min-h-screen bg-[#07080c] text-zinc-100">
                <PlexHomeSwitchModal
                    open
                    loginMode
                    users={homePickerUsers}
                    currentUserId={homePickerCurrentId}
                    busy={homePickerBusy}
                    error={homePickerError}
                    onSelect={(user, pin) => void handleHomePickerSelect(user, pin)}
                    onClose={() => setHomePickerDone(true)}
                />
            </div>
        );
    }

    if (!homePickerDone) {
        return <PlexClientBootSplash />;
    }

    if (setupPending) {
        return (
            <PlexClientFirstRunSetup
                onDone={() => {
                    setSetupPending(false);
                    prefetchMediaPlayerHome();
                }}
            />
        );
    }

    return (
        <div className="plex-client-shell min-h-screen bg-zinc-950 text-zinc-100">
            <MediaPlayerDashboard />
            <ApkWhatsNew />
            <PlayerPerfOverlay />
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(
        <DiscoverI18nProvider>
            <PlexClientApp />
        </DiscoverI18nProvider>,
    );
}
