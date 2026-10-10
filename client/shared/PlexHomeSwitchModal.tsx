import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Lock, User, X } from 'lucide-react';
import { lockBackgroundScroll } from './lockBackgroundScroll';

export type PlexHomeProfile = {
    id: string;
    uuid?: string;
    title: string;
    thumb?: string | null;
    restricted?: boolean;
    admin?: boolean;
    protected?: boolean;
};

const isSameProfile = (user: PlexHomeProfile, targetId?: string | null) => {
    const want = String(targetId || '').trim();
    if (!want || !user) return false;
    return [user.id, user.uuid].some((value) => String(value || '').trim() === want);
};

const ProfileAvatar: React.FC<{
    user: PlexHomeProfile;
    current?: boolean;
    compact?: boolean;
}> = ({ user, current = false, compact = false }) => {
    const sizeClass = compact
        ? 'h-11 w-11 sm:h-16 sm:w-16'
        : 'h-12 w-12 sm:h-24 sm:w-24';
    const ringClass = current
        ? 'border-plex shadow-[0_0_0_3px_rgba(229,160,13,0.2)] sm:shadow-[0_0_0_4px_rgba(229,160,13,0.2)]'
        : 'border-white/15 group-hover:border-plex/70';

    return (
        <span className="relative">
            {user.thumb ? (
                <img
                    src={user.thumb}
                    alt=""
                    className={`${sizeClass} rounded-full object-cover border-2 transition ${ringClass}`}
                />
            ) : (
                <span className={`flex ${sizeClass} items-center justify-center rounded-full border-2 bg-black/40 text-muted ${ringClass}`}>
                    <User className={compact ? 'h-5 w-5 sm:h-7 sm:w-7' : 'h-5 w-5 sm:h-8 sm:w-8'} />
                </span>
            )}
            {user.protected ? (
                <span className={`absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border border-white/20 bg-black/85 text-muted ${compact ? 'h-5 w-5' : 'h-5 w-5 sm:h-7 sm:w-7'}`}>
                    <Lock className={compact ? 'h-2.5 w-2.5' : 'h-2.5 w-2.5 sm:h-3.5 sm:w-3.5'} />
                </span>
            ) : null}
        </span>
    );
};

export const PlexHomeSwitchModal: React.FC<{
    open: boolean;
    users: PlexHomeProfile[];
    currentUserId?: string | null;
    rememberUserId?: string | null;
    showRemember?: boolean;
    rememberDefault?: boolean;
    busy?: boolean;
    error?: string;
    loginMode?: boolean;
    onSelect: (user: PlexHomeProfile, pin: string | undefined, remember: boolean) => void;
    onClose: () => void;
    onViewProfile?: () => void;
    onUseDifferentAccount?: () => void;
}> = ({
    open,
    users,
    currentUserId,
    rememberUserId,
    showRemember = false,
    rememberDefault = true,
    busy,
    error,
    loginMode = false,
    onSelect,
    onClose,
    onViewProfile,
    onUseDifferentAccount,
}) => {
    const [pinUser, setPinUser] = useState<PlexHomeProfile | null>(null);
    const [pin, setPin] = useState('');
    const [remember, setRemember] = useState(rememberDefault);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (open) {
            setRemember(rememberDefault);
            setPinUser(null);
            setPin('');
        }
    }, [open, rememberDefault]);

    const isTvShell = typeof document !== 'undefined' && (
        document.documentElement?.dataset?.tv === '1'
        || window.__PLEX_CLIENT__?.isTv === true
    );

    useEffect(() => {
        if (!open) return undefined;
        const unlock = lockBackgroundScroll();
        const onOverlayClose = () => {
            if (busy) return;
            if (pinUser) {
                setPinUser(null);
                setPin('');
                return;
            }
            onCloseRef.current();
        };
        window.addEventListener('smp-tv-overlay-close', onOverlayClose);
        const id = window.requestAnimationFrame(() => {
            const root = document.querySelector<HTMLElement>('[data-tv-home-switch="1"]');
            if (!root) return;
            const pinKey = root.querySelector<HTMLElement>('[data-tv-key="home-switch-pin-1"]');
            const profile = root.querySelector<HTMLElement>('[data-tv-home-profile="1"]');
            const field = root.querySelector<HTMLElement>('input[data-tv-item="1"]');
            const target = pinKey || field || profile || root.querySelector<HTMLElement>('[data-tv-item="1"]');
            target?.focus({ preventScroll: true });
        });
        return () => {
            unlock();
            window.removeEventListener('smp-tv-overlay-close', onOverlayClose);
            window.cancelAnimationFrame(id);
        };
    }, [open, busy, pinUser]);

    const profiles = useMemo(
        () => (Array.isArray(users) ? users.filter((user) => user?.id) : []),
        [users],
    );

    if (!open || typeof document === 'undefined') return null;

    const choose = (user: PlexHomeProfile) => {
        if (busy) return;
        if (!loginMode && isSameProfile(user, currentUserId)) {
            onClose();
            return;
        }
        if (user.protected) {
            setPinUser(user);
            setPin('');
            return;
        }
        onSelect(user, undefined, remember);
    };

    const submitPin = (event?: React.FormEvent) => {
        event?.preventDefault();
        if (!pinUser || busy) return;
        const value = pin.trim();
        if (!value) return;
        onSelect(pinUser, value, remember);
    };

    const dismiss = () => {
        if (busy) return;
        if (loginMode && onUseDifferentAccount) {
            onUseDifferentAccount();
            return;
        }
        onClose();
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="plex-home-switch-title">
            <button
                type="button"
                tabIndex={-1}
                className="absolute inset-0 bg-black/75 backdrop-blur-xl cursor-default"
                aria-label={loginMode ? 'Use a different Plex account' : 'Close profile switcher'}
                onClick={dismiss}
            />
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-plex/20 blur-[90px]" />
                <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-amber-500/10 blur-[80px]" />
            </div>

            <div
                data-tv-home-switch="1"
                className="player-popup-surface relative w-full sm:max-w-2xl max-h-[min(72dvh,32rem)] sm:max-h-[min(86vh,40rem)] overflow-y-auto rounded-t-2xl sm:rounded-3xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.55)] animate-fade-in"
            >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-plex/70 to-transparent" />
                <div className="sm:hidden flex justify-center pt-2.5 pb-0.5" aria-hidden>
                    <span className="h-1 w-10 rounded-full bg-white/25" />
                </div>
                <div className="flex items-start justify-between gap-3 px-4 sm:px-8 pt-3 sm:pt-7 pb-1 sm:pb-2">
                    <div>
                        <p className="text-[10px] sm:text-[11px] font-bold text-plex uppercase tracking-[0.22em] mb-0.5 sm:mb-1">Plex Home</p>
                        <h2 id="plex-home-switch-title" className="text-xl sm:text-3xl font-black text-text tracking-tight">
                            Who&apos;s watching?
                        </h2>
                        <p className="hidden sm:block text-sm text-muted mt-1.5 max-w-md">
                            {loginMode
                                ? 'Pick a profile to continue. Managed family accounts use this Plex Home login, then a PIN if one is set.'
                                : 'Switch to another profile on this device. PIN-protected profiles need their Home PIN.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-key="home-switch-close"
                        tabIndex={0}
                        onClick={dismiss}
                        className="p-1.5 sm:p-2 rounded-xl text-muted hover:text-text hover:bg-white/5 transition-colors shrink-0"
                        aria-label={loginMode ? 'Use a different Plex account' : 'Close profile switcher'}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 sm:px-8 pb-[max(0.85rem,env(safe-area-inset-bottom))] sm:pb-6 pt-3 sm:pt-4">
                    {pinUser ? (
                        <div className="mb-3 flex items-center gap-3 rounded-xl border border-plex/40 bg-plex/10 px-3 py-2.5">
                            <ProfileAvatar user={pinUser} current compact />
                            <div className="min-w-0">
                                <p className="text-sm font-bold text-text truncate">{pinUser.title}</p>
                                <p className="text-[11px] text-muted">Plex Home PIN, not your plex.tv password</p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4" data-tv-rail="1">
                            {profiles.map((user) => {
                                const current = isSameProfile(user, currentUserId);
                                const remembered = isSameProfile(user, rememberUserId);
                                return (
                                    <button
                                        key={user.id}
                                        type="button"
                                        data-tv-item="1"
                                        data-tv-home-profile="1"
                                        data-tv-key={`home-switch-${user.id}`}
                                        tabIndex={0}
                                        disabled={busy}
                                        onClick={() => choose(user)}
                                        className={`group relative flex flex-col items-center gap-2 sm:gap-3 rounded-xl sm:rounded-2xl border px-2 py-3 sm:px-3 sm:py-5 transition-all duration-200 disabled:opacity-50 ${
                                            current
                                                ? 'border-plex/70 bg-plex/10 shadow-[0_0_32px_rgba(229,160,13,0.18)]'
                                                : remembered
                                                    ? 'border-plex/50 bg-plex/5 ring-1 ring-plex/25'
                                                    : 'border-white/10 bg-black/20 hover:border-plex/50 hover:bg-white/5 hover:-translate-y-0.5'
                                        }`}
                                    >
                                        {current ? (
                                            <span className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 text-[8px] sm:text-[9px] font-black uppercase tracking-[0.14em] text-plex">
                                                Watching
                                            </span>
                                        ) : null}
                                        <ProfileAvatar user={user} current={current} />
                                        <span className="text-xs sm:text-sm font-bold text-text line-clamp-2">{user.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {showRemember && !pinUser && !isTvShell ? (
                        <label className="mt-3 sm:mt-5 flex items-start gap-2.5 max-w-md cursor-pointer">
                            <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 accent-plex"
                                checked={remember}
                                onChange={(event) => setRemember(event.target.checked)}
                                disabled={busy}
                            />
                            <span className="text-xs text-muted leading-relaxed text-left">
                                <span className="font-semibold text-text">Automatically sign in</span> as this profile next time on this device
                            </span>
                        </label>
                    ) : null}

                    {pinUser ? (
                        <form
                            onSubmit={submitPin}
                            className="rounded-xl sm:rounded-2xl border border-plex/30 bg-black/35 p-3 sm:p-5"
                        >
                            {isTvShell ? (
                                <div className="mb-4">
                                    <p className="mb-3 text-center font-mono text-2xl tracking-[0.45em] text-text">
                                        {pin ? pin.replace(/./g, '•') : '••••'}
                                    </p>
                                    <div className="mx-auto grid max-w-[16rem] grid-cols-3 gap-2" data-tv-rail="1">
                                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'go'].map((key) => (
                                            <button
                                                key={key}
                                                type="button"
                                                data-tv-item="1"
                                                data-tv-key={`home-switch-pin-${key}`}
                                                tabIndex={0}
                                                disabled={busy}
                                                className="rounded-xl border border-white/15 bg-black/40 py-3 text-sm font-bold text-text hover:border-plex/60 hover:bg-plex/10 disabled:opacity-40"
                                                onClick={() => {
                                                    if (key === 'back') {
                                                        setPin((current) => current.slice(0, -1));
                                                        return;
                                                    }
                                                    if (key === 'go') {
                                                        submitPin();
                                                        return;
                                                    }
                                                    const next = `${pin}${key}`.replace(/\D/g, '').slice(0, 8);
                                                    setPin(next);
                                                    if (next.length >= 4 && pinUser && !busy) {
                                                        onSelect(pinUser, next, remember);
                                                    }
                                                }}
                                            >
                                                {key === 'back' ? 'Del' : key === 'go' ? 'OK' : key}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    data-tv-item="1"
                                    data-tv-key="home-switch-pin"
                                    tabIndex={0}
                                    value={pin}
                                    onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                                    className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-2.5 sm:py-3 text-center text-base sm:text-lg tracking-[0.4em] text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20"
                                    placeholder="••••"
                                    autoFocus
                                    disabled={busy}
                                />
                            )}
                            {showRemember && !isTvShell ? (
                                <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 accent-plex"
                                        checked={remember}
                                        onChange={(event) => setRemember(event.target.checked)}
                                        disabled={busy}
                                    />
                                    <span className="text-xs text-muted leading-relaxed text-left">
                                        <span className="font-semibold text-text">Automatically sign in</span> as this profile next time
                                    </span>
                                </label>
                            ) : null}
                            <div className="mt-3 flex gap-2">
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    data-tv-key="home-switch-pin-back"
                                    tabIndex={0}
                                    className="flex-1 rounded-xl border border-white/10 px-3 py-2 sm:py-2.5 text-xs font-bold text-muted hover:text-text"
                                    onClick={() => { setPinUser(null); setPin(''); }}
                                    disabled={busy}
                                >
                                    Back
                                </button>
                                <button
                                    type="submit"
                                    data-tv-item="1"
                                    data-tv-action="1"
                                    data-tv-key="home-switch-pin-submit"
                                    tabIndex={0}
                                    className="flex-1 rounded-xl bg-plex px-3 py-2 sm:py-2.5 text-xs font-bold text-background disabled:opacity-40"
                                    disabled={busy || pin.trim().length < 4}
                                >
                                    {loginMode ? 'Continue' : 'Switch profile'}
                                </button>
                            </div>
                        </form>
                    ) : null}

                    {error ? (
                        <p className="mt-3 sm:mt-4 text-sm text-red-300">{error}</p>
                    ) : null}

                    {(loginMode && onUseDifferentAccount) || onViewProfile ? (
                        <div className="mt-3 sm:mt-6 flex items-center justify-center gap-4">
                            {loginMode && onUseDifferentAccount ? (
                                <button
                                    type="button"
                                    data-tv-item="1"
                                    tabIndex={0}
                                    className="text-xs font-bold text-muted hover:text-text transition"
                                    onClick={onUseDifferentAccount}
                                    disabled={busy}
                                >
                                    Use a different Plex account
                                </button>
                            ) : null}
                            {onViewProfile ? (
                                <button
                                    type="button"
                                    className="text-xs font-bold text-muted hover:text-text transition"
                                    onClick={onViewProfile}
                                    disabled={busy}
                                >
                                    View profile
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>,
        document.body,
    );
};
