import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Film, History, Loader2, Lock, Play, Zap } from 'lucide-react';
import { apiFetch } from '../shared/api';
import { PlexHomeSwitchModal } from '../shared/PlexHomeSwitchModal';
import {
    clearPlexClientPortal,
    getPlexClientAppVersion,
    isAndroidTvUi,
    writeAuthMode,
    writeStoredPortalBaseUrl,
    writeStoredSessionToken,
} from './config';

type Props = {
    onAuthenticated: () => void;
};

type PinSession = {
    pinId: string;
    code: string;
    oauthState: string;
    clientId: string;
    /** Phone one-tap: app.plex.tv/auth with the long code prefilled, nothing to type. */
    authUrl?: string;
};

type HomeUser = {
    id: string;
    uuid?: string;
    title?: string;
    username?: string;
    thumb?: string | null;
    protected?: boolean;
    admin?: boolean;
};

const LINK_URL = 'https://plex.tv/link';

/** Plex's hosted sign-in for a strong PIN. Only the client that made the PIN can claim it. */
const plexWebAuthUrl = (clientId: string, code: string) => {
    const params = new URLSearchParams({
        clientID: clientId,
        code,
        'context[device][product]': 'StreamPilot',
    });
    return `https://app.plex.tv/auth#?${params.toString()}`;
};

const openExternal = (url: string) => {
    try { window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* restricted WebView */ }
};
/** Cinematic duotones for the poster wall (no real art exists before sign-in). */
const WALL_TONES: Array<[string, string]> = [
    ['#1f3b73', '#0a1022'], ['#7a1f3d', '#18060e'], ['#0f5c55', '#04141a'], ['#9a6414', '#1c1004'],
    ['#3d2a7a', '#0d0922'], ['#a3401a', '#1e0a04'], ['#1d5d8a', '#061523'], ['#5c1f6e', '#13061a'],
    ['#2f6b2a', '#08170a'], ['#8a1f1f', '#1a0505'], ['#22406b', '#070d1c'], ['#6b4a12', '#170f03'],
];
const WALL_COLUMNS = 4;
const WALL_TILES = 7;

/**
 * A slow, tilted wall of poster-shaped cards drifting up and down: reads as "media" at a
 * glance. Only transforms animate (one layer per column), so it stays light on TV sticks.
 */
const AuthMediaWall: React.FC = () => (
    <div className="smp-auth-bg pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="smp-wall">
            {Array.from({ length: WALL_COLUMNS }, (_, col) => {
                const tiles = Array.from({ length: WALL_TILES }, (_, row) => WALL_TONES[(col * 5 + row * 3) % WALL_TONES.length]);
                return (
                    <div key={col} className="smp-wall-col" style={{ animationDuration: `${68 + col * 11}s` }}>
                        {/* Twice over, so the loop seam never shows. */}
                        {[...tiles, ...tiles].map(([light, dark], index) => (
                            <div
                                key={index}
                                className="smp-wall-tile"
                                style={{ background: `linear-gradient(160deg, ${light} 0%, ${dark} 78%)` }}
                            >
                                <span className="smp-wall-orb" style={{ left: `${18 + ((index * 37) % 50)}%`, top: `${14 + ((index * 23) % 34)}%` }} />
                                <span className="smp-wall-title" />
                                <span className="smp-wall-sub" />
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
        <div className="smp-auth-scrim" />
        <div className="smp-auth-glow" />
    </div>
);

const LOGO_SRC = './logo.png';

const AuthMark: React.FC<{ tv?: boolean }> = ({ tv }) => (
    <div className={`smp-auth-mark relative ${tv ? 'h-16 w-[min(100%,22rem)]' : 'h-12 w-[min(100%,18rem)] sm:h-14 sm:w-[22rem]'}`}>
        <img src={LOGO_SRC} alt="StreamPilot" className="relative h-full w-full object-contain object-left" />
    </div>
);

export const PlexClientBootSplash: React.FC = () => {
    const version = getPlexClientAppVersion();
    return (
        <div id="boot-splash">
            <div className="boot-splash-mark">
                <img src={LOGO_SRC} alt="StreamPilot" />
            </div>
            <div className="boot-splash-progress" aria-hidden><span /></div>
            {version ? <p className="boot-splash-version">{version}</p> : null}
        </div>
    );
};

export const PlexClientAuthScreen: React.FC<Props> = ({ onAuthenticated }) => {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [pin, setPin] = useState<PinSession | null>(null);
    const [homeUsers, setHomeUsers] = useState<HomeUser[] | null>(null);
    const [homeSelectToken, setHomeSelectToken] = useState('');
    const [homeSwitchError, setHomeSwitchError] = useState('');
    const pollRef = useRef<number | null>(null);
    const isTv = isAndroidTvUi();

    const stopPoll = useCallback(() => {
        if (pollRef.current != null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    useEffect(() => () => stopPoll(), [stopPoll]);

    const finishWithToken = useCallback((sessionToken: string) => {
        writeStoredSessionToken(sessionToken);
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        setHomeSelectToken('');
        onAuthenticated();
    }, [onAuthenticated, stopPoll]);

    const pollCallback = useCallback(async (session: PinSession) => {
        try {
            const data = await apiFetch('/api/auth/plex/callback', {
                method: 'POST',
                body: JSON.stringify({
                    pinId: session.pinId,
                    oauthState: session.oauthState,
                }),
            });
            if (data?.pending) return;
            if (data?.sessionToken) {
                finishWithToken(String(data.sessionToken));
                return;
            }
            if (data?.needsHomeSelect && Array.isArray(data.users)) {
                stopPoll();
                setPin(null);
                setBusy(false);
                setHomeUsers(data.users);
                setHomeSelectToken(String(data.homeSelectToken || ''));
                setHomeSwitchError('');
                setError('');
                return;
            }
        } catch (err: any) {
            const message = String(err?.message || '');
            if (/Waiting for Plex|sign-in did not complete|CSRF|not found or expired/i.test(message)) return;
            setError(message || 'Login failed');
            stopPoll();
            setBusy(false);
        }
    }, [finishWithToken, stopPoll]);

    /** TV (or "Use a code instead") gets the short plex.tv/link PIN; phones sign in on Plex's page. */
    const pinRequest = (linkCode: boolean, extra: Record<string, unknown> = {}) => (
        linkCode ? { ...extra, linkCode: true } : { ...extra, strong: true }
    );

    const beginPin = (session: PinSession) => {
        setPin(session);
        if (!isTv) openExternal(session.authUrl || LINK_URL);
        pollRef.current = window.setInterval(() => { void pollCallback(session); }, 2000);
        void pollCallback(session);
    };

    const startDirectLogin = async (forceLinkCode = false) => {
        setError('');
        setBusy(true);
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        // Plex sign-in only: this device talks to the Plex servers directly.
        writeAuthMode('plex');
        writeStoredPortalBaseUrl('');
        const linkCode = isTv || forceLinkCode;
        try {
            const data = await apiFetch('/api/auth/plex/login', {
                method: 'POST',
                body: JSON.stringify(pinRequest(linkCode)),
            });
            const session: PinSession = {
                pinId: String(data.id),
                code: String(data.code || '').trim(),
                oauthState: String(data.oauthState || 'direct'),
                clientId: String(data.clientIdentifier || ''),
            };
            if (!session.pinId || !session.code) throw new Error('Plex did not return a link code');
            if (linkCode) {
                session.code = session.code.toUpperCase();
                if (session.code.length > 6) {
                    throw new Error('Plex returned a code that plex.tv/link will not accept. Try again.');
                }
            } else {
                if (!session.clientId) throw new Error('Plex sign-in is missing a client id. Try again.');
                session.authUrl = plexWebAuthUrl(session.clientId, session.code);
            }
            beginPin(session);
        } catch (err: any) {
            setError(err?.message || 'Failed to start Plex login');
            setBusy(false);
        }
    };

    const confirmHomeUser = async (user: HomeUser, pinValue?: string) => {
        if (!user?.id) {
            setHomeSwitchError('Select a Plex Home profile');
            return;
        }
        if (!homeSelectToken) {
            setHomeSwitchError('Home selection expired. Start sign-in again.');
            return;
        }
        setBusy(true);
        setHomeSwitchError('');
        setError('');
        try {
            const data = await apiFetch('/api/auth/plex/home-switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: user.id,
                    homeSelectToken,
                    remember: true,
                    ...(pinValue ? { pin: pinValue } : {}),
                }),
            });
            if (data?.sessionToken) {
                finishWithToken(String(data.sessionToken));
                return;
            }
            throw new Error('Could not start this Plex Home profile');
        } catch (err: any) {
            setHomeSwitchError(err?.message || 'Could not switch Plex Home profile');
            setBusy(false);
        }
    };

    const startOver = () => {
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        setHomeSelectToken('');
        setHomeSwitchError('');
        setBusy(false);
        setError('');
        clearPlexClientPortal();
    };

    const stage = homeUsers ? 'home' : pin ? 'pin' : 'connect';
    const webAuth = Boolean(pin?.authUrl);

    // Android throttles the WebView while Plex's page is in front. Check the
    // moment the user comes back instead of waiting for the next 2s tick.
    useEffect(() => {
        if (!pin) return undefined;
        const onVisible = () => {
            if (document.visibilityState === 'visible') void pollCallback(pin);
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
        };
    }, [pin, pollCallback]);

    useEffect(() => {
        if (!isTv) return;
        const id = window.requestAnimationFrame(() => {
            const root = document.querySelector<HTMLElement>('[data-tv-auth="1"]');
            if (!root) return;
            const active = document.activeElement as HTMLElement | null;
            // Typing must keep the IME open. Refocusing Continue after each
            // letter was dismissing the leanback keyboard.
            if (active && root.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            const action = root.querySelector<HTMLElement>('[data-tv-action="1"]');
            const field = root.querySelector<HTMLInputElement>('input[data-tv-item="1"]');
            const prefilled = stage === 'connect' && Boolean(field?.value?.trim());
            const target = (prefilled ? action : field) || action || field;
            target?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(id);
    }, [isTv, stage]);

    const title = stage === 'home'
        ? 'Who’s watching?'
        : stage === 'pin'
            ? (webAuth ? 'Finish on Plex' : 'Link this device')
            : 'Start watching';
    const subtitle = stage === 'home'
        ? 'Choose a Plex Home profile to continue.'
        : stage === 'pin'
            ? (webAuth
                ? 'Sign in on the Plex page that opened, then come back here.'
                : 'On any phone or computer, open plex.tv/link and enter the code below.')
            : 'Sign in with your Plex account. This device talks to your Plex server directly.';

    return (
        <div className="smp-auth relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#06070b] text-zinc-100" data-tv-auth="1">
            <AuthMediaWall />
            <div className="smp-auth-shell relative z-10 flex min-h-screen items-end px-6 pb-8 pt-12 sm:items-center sm:px-12 sm:py-12 lg:px-20">
                <div className="smp-auth-col w-full max-w-xl lg:max-w-[36rem]">
                    <div className={`smp-auth-copy mb-8 space-y-6 ${isTv ? 'smp-tv-screen-enter' : ''}`}>
                        <AuthMark tv={isTv} />
                        {stage === 'connect' ? (
                            <div className="space-y-5">
                                <span className="smp-auth-eyebrow">
                                    <span className="smp-auth-eyebrow-dot" />
                                    Your media, every screen
                                </span>
                                <h1 className="smp-auth-headline text-white">
                                    Your whole library.
                                    <span className="smp-auth-headline-accent">One beautiful app.</span>
                                </h1>
                                <p className="max-w-md text-base leading-relaxed text-zinc-400 sm:text-lg">
                                    Films, shows and music from your Plex servers, streamed straight to this device.
                                </p>
                                <ul className="smp-auth-features">
                                    <li><Film className="h-4 w-4" />4K, HDR and Dolby audio</li>
                                    <li><Zap className="h-4 w-4" />Direct Play from your server</li>
                                    <li><History className="h-4 w-4" />Pick up where you left off</li>
                                </ul>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
                                    {title}
                                </h1>
                                <p className="max-w-md text-base leading-relaxed text-zinc-400">
                                    {subtitle}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className={stage === 'connect'
                        ? `smp-auth-cta ${isTv ? 'smp-tv-auth-panel-enter' : ''}`
                        : `rounded-[1.75rem] border border-white/10 bg-black/45 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-7 ${isTv ? 'smp-tv-auth-panel-enter' : ''}`}
                    >
                        {stage === 'connect' ? (
                            <div className="space-y-4" data-tv-rail="1">
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-key="auth-plex"
                                    tabIndex={0}
                                    className="smp-auth-button smp-auth-primary inline-flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-lg text-zinc-950 transition disabled:opacity-60 sm:w-auto sm:min-w-[20rem]"
                                    disabled={busy}
                                    onClick={() => { void startDirectLogin(); }}
                                >
                                    {busy
                                        ? <Loader2 className="h-5 w-5 animate-spin" />
                                        : <Play className="h-5 w-5" fill="currentColor" strokeWidth={0} />}
                                    Sign in with Plex
                                </button>
                                <p className="smp-auth-note">
                                    <Lock className="h-3.5 w-3.5" />
                                    Uses your Plex account. Nothing else to set up.
                                </p>
                            </div>
                        ) : null}

                        {stage === 'pin' && pin ? (
                            <div className="space-y-6" data-tv-rail="1">
                                {webAuth ? (
                                    <div className="space-y-4 text-center">
                                        <button
                                            type="button"
                                            data-tv-item="1"
                                            data-tv-action="1"
                                            tabIndex={0}
                                            className="smp-auth-button inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-plex to-amber-400 px-5 py-3.5 text-lg text-zinc-950 shadow-[0_10px_30px_rgba(229,160,13,0.28)] transition hover:brightness-110"
                                            onClick={() => openExternal(pin.authUrl || LINK_URL)}
                                        >
                                            Open Plex sign-in
                                        </button>
                                        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-plex" />
                                            Waiting for Plex
                                        </p>
                                        <button
                                            type="button"
                                            data-tv-item="1"
                                            tabIndex={0}
                                            className="block w-full text-sm font-semibold text-zinc-400 transition hover:text-white"
                                            onClick={() => void startDirectLogin(true)}
                                        >
                                            Use a code instead
                                        </button>
                                    </div>
                                ) : (
                                <div className="space-y-4 text-center">
                                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Your code</p>
                                    <div className="flex justify-center gap-2.5">
                                        {pin.code.split('').map((ch, index) => (
                                            <span
                                                key={`${ch}-${index}`}
                                                className="smp-auth-pin-tile flex h-[4.5rem] w-[3.25rem] items-center justify-center rounded-2xl border border-plex/35 bg-black/45 font-mono text-3xl font-black tracking-wide text-white shadow-[0_0_32px_rgba(229,160,13,0.12)] sm:h-20 sm:w-16 sm:text-4xl"
                                            >
                                                {ch}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-sm text-zinc-400">
                                        Enter this at{' '}
                                        <span className="font-semibold text-plex">{LINK_URL.replace('https://', '')}</span>
                                    </p>
                                    <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-plex" />
                                        Waiting for Plex
                                    </p>
                                </div>
                                )}
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-auth-back="1"
                                    data-tv-key="auth-start-over"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white"
                                    onClick={startOver}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Start over
                                </button>
                            </div>
                        ) : null}

                        {stage === 'home' && homeUsers ? (
                            <PlexHomeSwitchModal
                                open
                                loginMode
                                users={homeUsers.map((user) => ({
                                    id: user.id,
                                    uuid: user.uuid,
                                    title: user.title || user.username || user.id,
                                    thumb: user.thumb,
                                    protected: user.protected,
                                    admin: user.admin,
                                }))}
                                busy={busy}
                                error={homeSwitchError}
                                onSelect={(user, pinValue) => void confirmHomeUser(user, pinValue)}
                                onClose={startOver}
                                onUseDifferentAccount={startOver}
                            />
                        ) : null}

                        {error ? (
                            <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-950/40 px-4 py-3 text-sm leading-relaxed text-red-100" role="alert">
                                {error}
                            </p>
                        ) : null}
                    </div>

                </div>
            </div>
        </div>
    );
};
