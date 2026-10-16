import React, { useMemo, useState } from 'react';
import { Lock, User } from 'lucide-react';

type PlexHomeProfile = {
    id: string;
    uuid?: string;
    title: string;
    thumb?: string | null;
    restricted?: boolean;
    admin?: boolean;
    protected?: boolean;
};

export const PlexHomeSelect: React.FC<{
    users: PlexHomeProfile[];
    busy?: boolean;
    error?: string;
    rememberUserId?: string | null;
    onSelect: (user: PlexHomeProfile, pin: string | undefined, remember: boolean) => void;
    onCancel: () => void;
}> = ({ users, busy, error, rememberUserId, onSelect, onCancel }) => {
    const [pinUser, setPinUser] = useState<PlexHomeProfile | null>(null);
    const [pin, setPin] = useState('');
    const [remember, setRemember] = useState(true);

    const profiles = useMemo(
        () => (Array.isArray(users) ? users.filter((user) => user?.id) : []),
        [users],
    );

    const choose = (user: PlexHomeProfile) => {
        if (busy) return;
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

    return (
        <div className="w-full max-w-xl mx-auto flex flex-col items-center text-center">
            <p className="text-[11px] font-bold text-muted uppercase tracking-[0.16em] mb-2">Plex Home</p>
            <h1 className="text-3xl sm:text-4xl font-black text-text tracking-tight mb-2">Who&apos;s watching?</h1>
            <p className="text-muted text-sm sm:text-base leading-relaxed mb-8 max-w-sm">
                Pick a profile. Managed family accounts use the same Plex Home login, then a PIN if one is set.
            </p>

            <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-5">
                {profiles.map((user) => (
                    <button
                        key={user.id}
                        type="button"
                        disabled={busy}
                        onClick={() => choose(user)}
                        className={`group flex flex-col items-center gap-3 rounded-2xl border bg-black/20 px-3 py-4 transition hover:border-plex/50 hover:bg-white/5 disabled:opacity-50 ${
                            rememberUserId && (rememberUserId === user.id || rememberUserId === user.uuid)
                                ? 'border-plex/60 ring-1 ring-plex/30'
                                : 'border-white/10'
                        }`}
                    >
                        <span className="relative">
                            {user.thumb ? (
                                <img
                                    src={user.thumb}
                                    alt=""
                                    className="h-20 w-20 sm:h-24 sm:w-24 rounded-full object-cover border-2 border-white/15 group-hover:border-plex/60"
                                />
                            ) : (
                                <span className="flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full border-2 border-white/15 bg-black/40 text-muted group-hover:border-plex/60">
                                    <User className="h-8 w-8" />
                                </span>
                            )}
                            {user.protected ? (
                                <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/80 text-muted">
                                    <Lock className="h-3.5 w-3.5" />
                                </span>
                            ) : null}
                        </span>
                        <span className="text-sm font-bold text-text line-clamp-2">{user.title}</span>
                    </button>
                ))}
            </div>

            <label className="mt-6 flex items-start gap-2.5 max-w-sm text-left cursor-pointer">
                <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-plex"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    disabled={busy}
                />
                <span className="text-xs text-muted leading-relaxed">
                    <span className="font-semibold text-text">Automatically sign in</span> as this profile on this device
                </span>
            </label>

            {pinUser ? (
                <form
                    onSubmit={submitPin}
                    className="mt-8 w-full max-w-xs rounded-2xl border border-white/10 bg-black/30 p-4 text-left"
                >
                    <p className="text-sm font-bold text-text mb-1">Enter PIN for {pinUser.title}</p>
                    <p className="text-xs text-muted mb-3">This is the Plex Home PIN for that profile, not your plex.tv password.</p>
                    <input
                        type="password"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={pin}
                        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                        className="w-full bg-black/25 border border-white/15 rounded-xl px-4 py-3 text-center text-lg tracking-[0.4em] text-text outline-none focus:border-plex/70 focus:ring-2 focus:ring-plex/20"
                        placeholder="••••"
                        autoFocus
                        disabled={busy}
                    />
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-muted hover:text-text"
                            onClick={() => { setPinUser(null); setPin(''); }}
                            disabled={busy}
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            className="flex-1 rounded-xl bg-plex px-3 py-2 text-xs font-bold text-background disabled:opacity-40"
                            disabled={busy || pin.trim().length < 4}
                        >
                            Continue
                        </button>
                    </div>
                </form>
            ) : null}

            {error ? (
                <p className="mt-4 text-sm text-red-300">{error}</p>
            ) : null}

            <button
                type="button"
                className="mt-8 text-xs font-bold text-muted hover:text-text transition"
                onClick={onCancel}
                disabled={busy}
            >
                Use a different Plex account
            </button>
        </div>
    );
};
