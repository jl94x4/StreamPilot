import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscoverI18nProvider } from '../discovery/i18n';
import { MediaPlayerDashboard } from '../media-player/MediaPlayerDashboard';
import { prefetchMediaPlayerHome } from '../media-player/api';
import { PLAYER_APP_BASE, PLAYER_LOGOUT_EVENT } from '../media-player/paths';
import { apiFetch } from '../shared/api';
import { ApkWhatsNew } from './ApkWhatsNew';
import { PlexClientAuthScreen, PlexClientBootSplash } from './AuthScreen';
import { hydratePlexClientAuthStorage } from './authPersistence';
import { withBootTimeout } from './bootTimeout';
import {
    bootstrapPlexClientConfig,
    clearPlexClientSession,
    detectAndApplyTvUi,
    getSessionToken,
    isAndroidTvUi,
} from './config';
import { installNativeMediaPlayerBridge } from './nativePlayer';
import { useTvRemote } from './useTvRemote';

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
        prefetchMediaPlayerHome();
        setAuthed(true);
    }, []);

    useEffect(() => {
        const onLogout = () => {
            void apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
            clearPlexClientSession();
            setAuthed(false);
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

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100">
            <MediaPlayerDashboard />
            <ApkWhatsNew />
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
