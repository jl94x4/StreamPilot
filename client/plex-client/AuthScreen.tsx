import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Globe, Loader2 } from 'lucide-react';
import { apiFetch } from '../shared/api';
import {
    clearPlexClientPortal,
    getPortalBaseUrl,
    isAndroidTvUi,
    normalizePortalBaseUrl,
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
};

type HomeUser = {
    id: string;
    title?: string;
    username?: string;
    thumb?: string | null;
    protected?: boolean;
};

const LINK_URL = 'https://plex.tv/link';
const POSTER_HUES = [24, 32, 18, 38, 28, 14, 42, 22, 35, 16, 30, 40, 20, 26, 12, 36, 19, 33];

const displayHost = (raw: string) => {
    const normalized = normalizePortalBaseUrl(raw);
    if (!normalized.ok) return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    try {
        const url = new URL(normalized.url);
        return url.host + (url.pathname !== '/' ? url.pathname.replace(/\/+$/, '') : '');
    } catch {
        return normalized.url.replace(/^https?:\/\//i, '');
    }
};

const AuthAtmosphere: React.FC<{ tv?: boolean }> = ({ tv }) => (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute inset-0 bg-[#07080c]" />
        {tv ? (
            <div
                className="absolute left-1/2 top-[46%] h-[42rem] w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/[0.16] blur-[140px]"
            />
        ) : (
            <>
                <div className="absolute -top-32 -left-24 h-[34rem] w-[34rem] rounded-full bg-plex/20 blur-[140px]" />
                <div className="absolute top-[18%] right-[-8%] h-[28rem] w-[28rem] rounded-full bg-amber-700/20 blur-[120px]" />
                <div className="absolute bottom-[-18%] left-[22%] h-[24rem] w-[24rem] rounded-full bg-plex/10 blur-[110px]" />
                <div
                    className="absolute inset-0 opacity-90"
                    style={{ backgroundImage: 'radial-gradient(ellipse 70% 55% at 18% 12%, rgba(229,160,13,0.16), transparent 58%)' }}
                />
                <div className="absolute inset-y-[-12%] right-[-6%] hidden w-[58%] rotate-[-11deg] md:block">
                    <div className="grid h-full grid-cols-6 gap-3 opacity-[0.42]">
                        {POSTER_HUES.map((hue, index) => (
                            <div
                                key={`${hue}-${index}`}
                                className="relative overflow-hidden rounded-xl border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
                                style={{
                                    marginTop: `${(index % 3) * 1.6}rem`,
                                    background: `linear-gradient(165deg, hsl(${hue} 55% ${22 + (index % 4) * 4}%) 0%, hsl(${hue + 8} 40% 8%) 100%)`,
                                }}
                            >
                                <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/10 to-transparent" />
                            </div>
                        ))}
                    </div>
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-[#07080c] via-[#07080c]/88 to-[#07080c]/35" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-transparent to-[#07080c]/70" />
                <div
                    className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
                    style={{
                        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.35) 2px, rgba(255,255,255,0.35) 3px), repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.2) 3px, rgba(255,255,255,0.2) 4px)',
                    }}
                />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.55)_100%)]" />
            </>
        )}
    </div>
);

const LOGO_SRC = './logo.png';

const AuthMark: React.FC<{ tv?: boolean }> = ({ tv }) => (
    <div className="smp-auth-mark relative h-14 w-14 sm:h-16 sm:w-16">
        {tv ? null : <div className="absolute inset-[-22%] rounded-full bg-plex/20 blur-2xl" aria-hidden />}
        <img src={LOGO_SRC} alt="StreamPilot" className="relative h-full w-full object-contain" />
    </div>
);

export const PlexClientBootSplash: React.FC = () => (
    <div id="boot-splash">
        <div className="boot-splash-glow" aria-hidden />
        <div className="boot-splash-mark">
            <img src={LOGO_SRC} alt="StreamPilot" />
        </div>
        <div className="boot-splash-progress" aria-hidden><span /></div>
    </div>
);

export const PlexClientAuthScreen: React.FC<Props> = ({ onAuthenticated }) => {
    const [portalUrl, setPortalUrl] = useState(getPortalBaseUrl());
    const [usePortal, setUsePortal] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [pin, setPin] = useState<PinSession | null>(null);
    const [checkingPortal, setCheckingPortal] = useState(false);
    const [homeUsers, setHomeUsers] = useState<HomeUser[] | null>(null);
    const [homeSelectToken, setHomeSelectToken] = useState('');
    const [homePin, setHomePin] = useState('');
    const [selectedHomeUserId, setSelectedHomeUserId] = useState<string | null>(null);
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
                setSelectedHomeUserId(String(data.rememberUserId || data.users[0]?.id || '') || null);
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

    const applyPortalUrl = (raw: string) => {
        const normalized = normalizePortalBaseUrl(raw);
        if (!normalized.ok) {
            setError(normalized.error);
            return null;
        }
        writeStoredPortalBaseUrl(normalized.url);
        setPortalUrl(normalized.url);
        return normalized.url;
    };

    const startDirectLogin = async () => {
        setError('');
        setBusy(true);
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        writeAuthMode('plex');
        writeStoredPortalBaseUrl('');
        try {
            const data = await apiFetch('/api/auth/plex/login', {
                method: 'POST',
                body: JSON.stringify({ linkCode: true }),
            });
            const session: PinSession = {
                pinId: String(data.id),
                code: String(data.code || '').trim().toUpperCase(),
                oauthState: String(data.oauthState || 'direct'),
                clientId: String(data.clientIdentifier || ''),
            };
            if (!session.pinId || !session.code) throw new Error('Plex did not return a link code');
            if (session.code.length > 6) {
                throw new Error('Plex returned a code that plex.tv/link will not accept. Try again.');
            }
            setPin(session);
            if (!isTv) {
                try { window.open(LINK_URL, '_blank', 'noopener,noreferrer'); } catch { /* tv */ }
            }
            pollRef.current = window.setInterval(() => { void pollCallback(session); }, 2000);
            void pollCallback(session);
        } catch (err: any) {
            setError(err?.message || 'Failed to start Plex login');
            setBusy(false);
        }
    };

    const startPinLogin = async () => {
        setError('');
        setBusy(true);
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        setHomeSelectToken('');
        setHomePin('');

        writeAuthMode('portal');
        const url = applyPortalUrl(portalUrl);
        if (!url) {
            setBusy(false);
            return;
        }

        setCheckingPortal(true);
        try {
            const diagnostics = await apiFetch('/api/auth/diagnostics').catch(() => null);
            if (!diagnostics || diagnostics.configured === undefined) {
                throw new Error('Could not reach StreamPilot at that URL. Check the address and that the portal is online.');
            }
        } catch (err: any) {
            setError(err?.message || 'Portal not reachable');
            setBusy(false);
            setCheckingPortal(false);
            return;
        } finally {
            setCheckingPortal(false);
        }

        try {
            const data = await apiFetch('/api/auth/plex/login', {
                method: 'POST',
                body: JSON.stringify({ skipHomeRemember: true, linkCode: true }),
            });
            const rawCode = String(data.code || '').trim();
            const session: PinSession = {
                pinId: String(data.id),
                code: rawCode.toUpperCase(),
                oauthState: String(data.oauthState || ''),
                clientId: String(data.clientIdentifier || data.clientId || ''),
            };
            if (!session.pinId || !session.oauthState) {
                throw new Error('Portal did not return a PIN session (update StreamPilot if this persists).');
            }
            if (session.code.length > 6) {
                throw new Error('Portal returned a long auth code. Update StreamPilot to a build that supports linkCode PINs.');
            }
            setPin(session);

            if (!isTv) {
                try {
                    window.open(LINK_URL, '_blank', 'noopener,noreferrer');
                } catch {
                    /* restricted WebView */
                }
            }

            pollRef.current = window.setInterval(() => {
                void pollCallback(session);
            }, 2000);
            void pollCallback(session);
        } catch (err: any) {
            setError(err?.message || 'Failed to start Plex login');
            setBusy(false);
        }
    };

    const confirmHomeUser = async () => {
        if (!selectedHomeUserId) {
            setError('Select a Plex Home profile');
            return;
        }
        if (!homeSelectToken) {
            setError('Home selection expired. Start sign-in again.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const data = await apiFetch('/api/auth/plex/home-switch', {
                method: 'POST',
                body: JSON.stringify({
                    userId: selectedHomeUserId,
                    homeSelectToken,
                    remember: false,
                    ...(homePin.trim() ? { pin: homePin.trim() } : {}),
                }),
            });
            if (data?.sessionToken) {
                finishWithToken(String(data.sessionToken));
                return;
            }
            throw new Error('Portal did not return a session token');
        } catch (err: any) {
            setError(err?.message || 'Could not switch Plex Home profile');
            setBusy(false);
        }
    };

    const changePortal = () => {
        stopPoll();
        setPin(null);
        setHomeUsers(null);
        setHomeSelectToken('');
        setBusy(false);
        setError('');
        clearPlexClientPortal();
        setPortalUrl('');
    };

    const selectedHomeUser = useMemo(
        () => (homeUsers || []).find((user) => String(user.id) === String(selectedHomeUserId || '')) || null,
        [homeUsers, selectedHomeUserId],
    );
    const hostLabel = displayHost(portalUrl);
    const stage = homeUsers ? 'home' : pin ? 'pin' : 'connect';

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
            ? 'Link this device'
            : 'Start watching';
    const subtitle = stage === 'home'
        ? 'Choose a Plex Home profile to continue.'
        : stage === 'pin'
            ? 'On any phone or computer, open plex.tv/link and enter the code below.'
            : usePortal
                ? 'Connect once to your StreamPilot, then sign in with Plex.'
                : 'Sign in with your Plex account. This device talks to your Plex server directly.';

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#07080c] text-zinc-100" data-tv-auth="1">
            <AuthAtmosphere tv={isTv} />
            <div className="smp-auth-shell relative z-10 flex min-h-screen items-center px-5 py-10 sm:px-10 lg:px-16">
                <div className="w-full max-w-xl lg:max-w-[34rem]">
                    <div className={`smp-auth-copy mb-8 space-y-5 ${isTv ? 'smp-tv-screen-enter' : ''}`}>
                        <AuthMark tv={isTv} />
                        <div className="space-y-3">
                            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
                                {title}
                            </h1>
                            <p className="max-w-md text-base leading-relaxed text-zinc-400">
                                {subtitle}
                            </p>
                        </div>
                    </div>

                    <div className={`rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-7 ${isTv ? 'smp-tv-auth-panel-enter' : ''}`}>
                        {stage === 'connect' && !usePortal ? (
                            <div className="space-y-4" data-tv-rail="1">
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-key="auth-plex"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-plex to-amber-400 px-5 py-3.5 text-base font-black text-zinc-950 shadow-[0_10px_30px_rgba(229,160,13,0.28)] transition hover:brightness-110 disabled:opacity-60"
                                    disabled={busy}
                                    onClick={() => { void startDirectLogin(); }}
                                >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Sign in with Plex
                                </button>
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-key="auth-use-portal"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white"
                                    onClick={() => {
                                        writeAuthMode('portal');
                                        setUsePortal(true);
                                        setError('');
                                    }}
                                >
                                    Use a StreamPilot portal
                                </button>
                            </div>
                        ) : null}

                        {stage === 'connect' && usePortal ? (
                            <form
                                className="space-y-5"
                                data-tv-rail="1"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void startPinLogin();
                                }}
                            >
                                <label className="block space-y-2.5">
                                    <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                                        <Globe className="h-3.5 w-3.5 text-plex" />
                                        Portal address
                                    </span>
                                    <input
                                        data-tv-item="1"
                                        data-tv-key="auth-portal-url"
                                        tabIndex={0}
                                        className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-plex/70 focus:ring-2 focus:ring-plex/25"
                                        value={portalUrl}
                                        onChange={(e) => setPortalUrl(e.target.value)}
                                        placeholder="https://portal.example.com"
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                        inputMode="url"
                                        autoComplete="url"
                                        disabled={busy}
                                    />
                                    <span className="block text-xs leading-relaxed text-zinc-500">
                                        The address you open in a browser for StreamPilot.
                                    </span>
                                </label>
                                <button
                                    type="submit"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-key="auth-continue"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-plex to-amber-400 px-5 py-3.5 text-base font-black text-zinc-950 shadow-[0_10px_30px_rgba(229,160,13,0.28)] transition hover:brightness-110 disabled:opacity-60"
                                    disabled={busy}
                                >
                                    {checkingPortal ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Checking portal…
                                        </>
                                    ) : (
                                        <>
                                            Continue with Plex
                                        </>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-key="auth-back-plex"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-2 text-sm font-bold text-zinc-400 transition hover:text-white"
                                    onClick={() => {
                                        writeAuthMode('plex');
                                        setUsePortal(false);
                                        setError('');
                                    }}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Sign in with Plex instead
                                </button>
                            </form>
                        ) : null}

                        {stage === 'pin' && pin ? (
                            <div className="space-y-6" data-tv-rail="1">
                                {hostLabel ? (
                                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                                        Connected to {hostLabel}
                                    </div>
                                ) : null}
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
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-auth-back="1"
                                    data-tv-key="auth-change-portal"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white"
                                    onClick={changePortal}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    {usePortal ? 'Use a different portal' : 'Start over'}
                                </button>
                            </div>
                        ) : null}

                        {stage === 'home' && homeUsers ? (
                            <div className="space-y-5" data-tv-rail="1">
                                <div className={`grid gap-2.5 ${isTv ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                                    {homeUsers.map((user) => {
                                        const active = selectedHomeUserId === String(user.id);
                                        const label = user.title || user.username || user.id;
                                        return (
                                            <button
                                                key={user.id}
                                                type="button"
                                                data-tv-item="1"
                                                data-tv-key={`auth-home-${user.id}`}
                                                tabIndex={0}
                                                onClick={() => setSelectedHomeUserId(String(user.id))}
                                                className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${
                                                    active
                                                        ? 'border-plex bg-plex/10 shadow-[0_0_24px_rgba(229,160,13,0.12)]'
                                                        : 'border-white/10 bg-black/30 hover:border-white/20'
                                                }`}
                                            >
                                                {user.thumb ? (
                                                    <img src={user.thumb} alt="" className="h-11 w-11 rounded-full object-cover ring-1 ring-white/10" />
                                                ) : (
                                                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-black">
                                                        {String(label).charAt(0).toUpperCase()}
                                                    </span>
                                                )}
                                                <span className="min-w-0 flex-1 truncate font-semibold">{label}</span>
                                                {active ? <Check className="h-4 w-4 shrink-0 text-plex" /> : null}
                                                {user.protected ? (
                                                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-500">PIN</span>
                                                ) : null}
                                            </button>
                                        );
                                    })}
                                </div>
                                {selectedHomeUser?.protected ? (
                                    <label className="block space-y-2">
                                        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">Profile PIN</span>
                                        <input
                                            data-tv-item="1"
                                            data-tv-key="auth-home-pin"
                                            tabIndex={0}
                                            className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5 text-base text-white outline-none transition focus:border-plex/70 focus:ring-2 focus:ring-plex/25"
                                            value={homePin}
                                            onChange={(e) => setHomePin(e.target.value)}
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            placeholder="Required for this profile"
                                        />
                                    </label>
                                ) : null}
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-key="auth-home-continue"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-plex to-amber-400 px-5 py-3.5 text-base font-black text-zinc-950 shadow-[0_10px_30px_rgba(229,160,13,0.28)] transition hover:brightness-110 disabled:opacity-60"
                                    onClick={() => void confirmHomeUser()}
                                    disabled={busy}
                                >
                                    {busy ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Signing in…
                                        </>
                                    ) : (
                                        'Continue'
                                    )}
                                </button>
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-auth-back="1"
                                    data-tv-key="auth-home-change-portal"
                                    tabIndex={0}
                                    className="inline-flex w-full items-center justify-center gap-2 text-sm font-semibold text-zinc-500 transition hover:text-zinc-300"
                                    onClick={changePortal}
                                >
                                    {usePortal ? 'Use a different portal' : 'Start over'}
                                </button>
                            </div>
                        ) : null}

                        {error ? (
                            <p className="mt-5 rounded-2xl border border-red-500/25 bg-red-950/40 px-4 py-3 text-sm leading-relaxed text-red-100" role="alert">
                                {error}
                            </p>
                        ) : null}
                    </div>

                    {stage === 'connect' && getPortalBaseUrl() ? (
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-auth-back="1"
                            data-tv-key="auth-connect-change-portal"
                            tabIndex={0}
                            className="mt-5 text-sm font-semibold text-zinc-500 transition hover:text-zinc-300"
                            onClick={changePortal}
                        >
                            Use a different portal
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
};
