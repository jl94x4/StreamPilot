import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, RotateCcw, Users } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { isAndroidTvUi } from '../plex-client/config';
import { isHostInAppSupported, onHostStage, type HostInfo, type HostStage } from '../plex-client/watchTogetherHost';
import { plexBackdropUrl, plexImageUrl } from './playerUtils';
import {
    collectWatchTogetherGuids,
    discardWatchTogetherClient,
    fetchWatchTogetherRoomSummary,
    getWatchTogetherClient,
    hasWatchTogetherRelay,
    resolveWatchTogetherIdentity,
    type WtRoomState,
} from './watchTogetherClient';
import type { PlayerItem } from './types';

type Mode = 'create' | 'join';

/** A room that has not come up by now will not: show what happened instead of waiting. */
const CREATE_TIMEOUT_MS = 35_000;

class DeadlineError extends Error {}

const withDeadline = <T,>(promise: Promise<T>, ms: number): Promise<T> => (
    new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new DeadlineError('deadline')), ms);
        promise.then(
            (value) => { window.clearTimeout(timer); resolve(value); },
            (error) => { window.clearTimeout(timer); reject(error); },
        );
    })
);

const STAGE_ORDER: HostStage[] = ['starting', 'router', 'room'];

/** Profile picture, or the first letter when there is none or it does not load. */
const RosterAvatar: React.FC<{ name: string; thumb?: string | null }> = ({ name, thumb }) => {
    const [failed, setFailed] = useState(false);
    const url = /^https?:\/\//i.test(String(thumb || '')) ? String(thumb) : '';
    useEffect(() => setFailed(false), [url]);
    return (
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-plex/20 text-sm font-bold text-plex">
            {url && !failed ? (
                <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setFailed(true)}
                />
            ) : (name || '?').slice(0, 1).toUpperCase()}
        </span>
    );
};

type Props = {
    mode: Mode;
    /** Create flow — title to host. */
    item?: PlayerItem | null;
    /** Join flow — invite code from deep link. */
    inviteCode?: string;
    onBack: () => void;
    onStart: (state: WtRoomState) => void;
    onToast?: (message: string, tone?: 'success' | 'error' | 'info') => void;
};

export const WatchTogetherLobby: React.FC<Props> = ({
    mode,
    item,
    inviteCode: inviteCodeProp,
    onBack,
    onStart,
    onToast,
}) => {
    const { t } = useDiscoverI18n();
    const tvShell = isAndroidTvUi();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [joinCode, setJoinCode] = useState(String(inviteCodeProp || '').toUpperCase());
    const [room, setRoom] = useState<WtRoomState | null>(null);
    const [previewTitle, setPreviewTitle] = useState('');
    /** Set when the room is hosted on this device: how far its invite reaches. */
    const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
    const startedRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    /** Which step of starting a hosted room is under way (null on the relay or before it starts). */
    const [stage, setStage] = useState<HostStage | null>(null);
    /** Bumped by "Try again" so the room is started once more. */
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        const client = getWatchTogetherClient();
        return client.onState((state) => setRoom(state));
    }, []);

    useEffect(() => onHostStage((next) => setStage(next)), []);

    useEffect(() => {
        if (mode !== 'create' || !item?.ratingKey || room) return;
        let cancelled = false;
        setBusy(true);
        setError('');
        setStage(null);
        const opts = {
            ratingKey: item.ratingKey,
            serverId: String(item.serverId || ''),
            title: item.title || 'Watch Together',
            type: item.type || 'movie',
            thumb: item.thumb || null,
            positionMs: Number(item.viewOffsetMs) || 0,
            guids: collectWatchTogetherGuids(item),
            tmdbId: item.externalIds?.tmdb || item.tmdbId || null,
            year: item.year != null ? Number(item.year) : null,
        };
        // Host on this device first (no relay needed). When friends outside the network cannot reach
        // this device but a relay is set up, use the relay so everyone can join.
        const create = async (): Promise<WtRoomState> => {
            const relay = hasWatchTogetherRelay();
            if (isHostInAppSupported()) {
                try {
                    const identity = await resolveWatchTogetherIdentity();
                    const hosted = await getWatchTogetherClient().createHosted(opts, identity);
                    if (hosted.info.publicReachable || !relay) {
                        if (!cancelled) setHostInfo(hosted.info);
                        return hosted.state;
                    }
                } catch (error) {
                    if (!relay) throw error;
                }
                // Start over on the relay with a clean client (this also stops the local server).
                discardWatchTogetherClient();
            }
            const client = getWatchTogetherClient();
            client.useRelay();
            return client.create(opts);
        };
        void withDeadline(create(), CREATE_TIMEOUT_MS)
            .then((state) => {
                if (!cancelled) setRoom(state);
            })
            .catch((err: any) => {
                if (cancelled) return;
                // Stop whatever half started, so "Try again" begins clean.
                discardWatchTogetherClient();
                setError(err instanceof DeadlineError
                    ? t('mediaPlayerPage.watchTogetherTookTooLong')
                    : String(err?.message || t('mediaPlayerPage.watchTogetherError')));
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => { cancelled = true; };
    }, [mode, item?.ratingKey, item?.serverId, item?.title, item?.type, item?.thumb, item?.viewOffsetMs, item?.plexGuid, item?.tmdbId, item?.year, item?.externalIds, room, t, attempt]);

    useEffect(() => {
        const code = String(inviteCodeProp || '').trim();
        if (mode !== 'join' || !code) return;
        let cancelled = false;
        setBusy(true);
        setError('');
        void (async () => {
            const summary = await fetchWatchTogetherRoomSummary(code);
            if (cancelled) return;
            if (summary?.title) setPreviewTitle(summary.title);
            try {
                const state = await getWatchTogetherClient().joinInvite(code, await resolveWatchTogetherIdentity());
                if (!cancelled) setRoom(state);
            } catch (err: any) {
                if (!cancelled) setError(String(err?.message || t('mediaPlayerPage.watchTogetherError')));
            } finally {
                if (!cancelled) setBusy(false);
            }
        })();
        return () => { cancelled = true; };
    }, [mode, inviteCodeProp, t]);

    useEffect(() => {
        if (!tvShell) return;
        const id = window.setTimeout(() => {
            const primary = document.querySelector<HTMLElement>(
                '[data-tv-watch-together="1"] [data-tv-action="1"]',
            );
            primary?.focus();
        }, 80);
        return () => window.clearTimeout(id);
    }, [tvShell, room?.inviteCode, busy]);

    const title = room?.title || item?.title || previewTitle || t('mediaPlayerPage.watchTogether');
    // Hosted-room invites are long (they carry the host's address); relay codes are six letters.
    const code = room?.shareCode || room?.inviteCode || '';
    const roster = room?.participants || [];

    const copyCode = async () => {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            onToast?.(t('mediaPlayerPage.watchTogetherCodeCopied'), 'success');
        } catch {
            onToast?.(code, 'info');
        }
    };

    const onJoinSubmit = async (event?: React.FormEvent) => {
        event?.preventDefault();
        const next = String(joinCode || '').trim().toUpperCase();
        if (!next) {
            setError(t('mediaPlayerPage.watchTogetherEnterCode'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            const state = await getWatchTogetherClient().joinInvite(next, await resolveWatchTogetherIdentity());
            setRoom(state);
        } catch (err: any) {
            setError(String(err?.message || t('mediaPlayerPage.watchTogetherError')));
        } finally {
            setBusy(false);
        }
    };

    const onReadyStart = () => {
        if (!room || startedRef.current) return;
        startedRef.current = true;
        onStart(room);
    };

    const onLeave = () => {
        discardWatchTogetherClient();
        onBack();
    };

    const showJoinForm = mode === 'join' && !room;

    const subtitle = useMemo(() => {
        if (showJoinForm) return t('mediaPlayerPage.watchTogetherJoinHint');
        if (mode === 'create') return t('mediaPlayerPage.watchTogetherShareHint');
        return t('mediaPlayerPage.watchTogetherWaitingHint');
    }, [mode, showJoinForm, t]);

    const backdrop = item?.art ? plexBackdropUrl(item.art) : '';
    const poster = item?.thumb ? plexImageUrl(item.thumb, 360, 540) : '';
    const hosting = mode === 'create' && isHostInAppSupported();
    const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
    const stageRows: Array<{ id: HostStage; label: string }> = [
        { id: 'starting', label: t('mediaPlayerPage.watchTogetherStageStarting') },
        { id: 'router', label: t('mediaPlayerPage.watchTogetherStageRouter') },
        { id: 'room', label: t('mediaPlayerPage.watchTogetherStageRoom') },
    ];

    return (
        <div
            className="relative flex min-h-screen flex-col gap-6 px-4 py-6 md:px-8"
            data-tv-watch-together="1"
            data-tv-screen="1"
        >
            {/* One full-screen backdrop behind everything, so the page is never half one colour. */}
            <div className="pointer-events-none fixed inset-0 z-0 bg-[#06080d]" aria-hidden="true">
                {backdrop ? (
                    <img
                        src={backdrop}
                        alt=""
                        className="h-full w-full object-cover opacity-40"
                        decoding="async"
                    />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-r from-[#06080d] via-[#06080d]/85 to-[#06080d]/45" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#06080d] via-transparent to-[#06080d]/70" />
            </div>
            <div className="relative z-10 flex items-center gap-3">
                <button
                    type="button"
                    data-tv-item="1"
                    data-tv-action="1"
                    data-tv-key="wt-back"
                    onClick={onLeave}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition-colors hover:border-plex/40 hover:bg-white/10"
                    aria-label={t('common.back')}
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-plex">
                        {t('mediaPlayerPage.watchTogether')}
                    </p>
                    <h1 className="truncate text-2xl font-black text-white">{title}</h1>
                    <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
                </div>
            </div>

            {error ? (
                <div className="relative z-10 flex max-w-xl flex-col items-start gap-3 rounded-2xl border border-red-500/30 bg-red-950/40 px-5 py-4" role="alert">
                    <p className="text-sm text-red-100">{error}</p>
                    {mode === 'create' ? (
                        <button
                            type="button"
                            data-tv-item="1"
                            data-tv-action="1"
                            data-tv-key="wt-retry"
                            onClick={() => { setError(''); setAttempt((n) => n + 1); }}
                            className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/15"
                        >
                            <RotateCcw className="h-4 w-4" />
                            {t('mediaPlayerPage.watchTogetherTryAgain')}
                        </button>
                    ) : null}
                </div>
            ) : null}

            {showJoinForm ? (
                <form className="relative z-10 flex max-w-md flex-col gap-3" onSubmit={(e) => void onJoinSubmit(e)}>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                        {t('mediaPlayerPage.watchTogetherInviteCode')}
                        <input
                            ref={inputRef}
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 44))}
                            data-tv-item="1"
                            data-tv-key="wt-code"
                            className={`mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 font-mono text-white outline-none focus:border-plex/70 ${joinCode.length > 8 ? 'text-lg tracking-[0.12em]' : 'text-2xl tracking-[0.35em]'}`}
                            placeholder="ABC123"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={44}
                        />
                    </label>
                    <button
                        type="submit"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-key="wt-join"
                        disabled={busy}
                        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-plex px-5 text-sm font-bold text-zinc-950 disabled:opacity-50"
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                        {t('mediaPlayerPage.watchTogetherJoin')}
                    </button>
                </form>
            ) : null}

            {room ? (
                <div className="relative z-10 flex max-w-xl flex-col gap-5">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                            {t('mediaPlayerPage.watchTogetherInviteCode')}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <span className={`break-all font-mono font-black text-white ${code.length > 8 ? 'text-xl tracking-[0.12em]' : 'text-3xl tracking-[0.35em]'}`}>
                                {code}
                            </span>
                            <button
                                type="button"
                                data-tv-item="1"
                                data-tv-action="1"
                                data-tv-key="wt-copy"
                                onClick={() => void copyCode()}
                                className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-bold text-white hover:border-plex/40"
                            >
                                <Copy className="h-4 w-4" />
                                {t('mediaPlayerPage.watchTogetherCopyCode')}
                            </button>
                        </div>
                        {hostInfo ? (
                            <p className={`mt-3 text-sm ${hostInfo.publicReachable ? 'text-emerald-300' : 'text-amber-300'}`}>
                                {hostInfo.publicReachable
                                    ? t('mediaPlayerPage.watchTogetherHostedOpen')
                                    : t('mediaPlayerPage.watchTogetherHostedLan', { reason: hostInfo.reason })}
                            </p>
                        ) : null}
                    </div>

                    <div>
                        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                            {t('mediaPlayerPage.watchTogetherRoster')} ({roster.length})
                        </p>
                        <ul className="flex flex-col gap-2">
                            {roster.map((row) => (
                                <li
                                    key={row.clientId}
                                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
                                >
                                    <RosterAvatar name={row.displayName} thumb={row.thumb} />
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                                        {row.displayName}
                                        {row.userId === room.hostUserId ? (
                                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-plex">
                                                {t('mediaPlayerPage.watchTogetherHost')}
                                            </span>
                                        ) : null}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <button
                        type="button"
                        data-tv-item="1"
                        data-tv-action="1"
                        data-tv-key="wt-start"
                        onClick={onReadyStart}
                        disabled={busy}
                        className="inline-flex h-12 max-w-sm items-center justify-center gap-2 rounded-xl bg-plex px-5 text-sm font-bold text-zinc-950 disabled:opacity-50"
                    >
                        {t('mediaPlayerPage.watchTogetherStart')}
                    </button>
                </div>
            ) : null}

            {busy && !room && !error ? (
                <div className="relative z-10 flex max-w-2xl items-center gap-6 rounded-3xl border border-white/10 bg-black/40 p-6 backdrop-blur-sm">
                    {poster ? (
                        <img src={poster} alt="" className="hidden h-44 w-[7.5rem] shrink-0 rounded-xl object-cover shadow-2xl sm:block" decoding="async" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                            <span className="relative flex h-3 w-3">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-plex opacity-60" />
                                <span className="relative inline-flex h-3 w-3 rounded-full bg-plex" />
                            </span>
                            <p className="text-base font-bold text-white">
                                {mode === 'join' ? t('mediaPlayerPage.watchTogetherJoining') : t('mediaPlayerPage.watchTogetherSettingUp')}
                            </p>
                        </div>
                        {hosting ? (
                            <ul className="mt-5 flex flex-col gap-3">
                                {stageRows.map((row, index) => {
                                    const done = stageIndex > index;
                                    const active = stageIndex === index;
                                    return (
                                        <li key={row.id} className={`flex items-center gap-3 text-sm ${done ? 'text-zinc-300' : active ? 'text-white' : 'text-zinc-600'}`}>
                                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-300' : active ? 'border-plex/60 text-plex' : 'border-white/10'}`}>
                                                {done ? <Check className="h-3.5 w-3.5" /> : active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                            </span>
                                            {row.label}
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <p className="mt-3 text-sm text-zinc-400">{t('mediaPlayerPage.watchTogetherConnecting')}</p>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
