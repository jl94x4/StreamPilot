import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Copy, Loader2, Users } from 'lucide-react';
import { useDiscoverI18n } from './host';
import { isAndroidTvUi } from '../plex-client/config';
import {
    discardWatchTogetherClient,
    fetchWatchTogetherRoomSummary,
    getWatchTogetherClient,
    type WtRoomState,
} from './watchTogetherClient';
import type { PlayerItem } from './types';

type Mode = 'create' | 'join';

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
    const startedRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const client = getWatchTogetherClient();
        return client.onState((state) => setRoom(state));
    }, []);

    useEffect(() => {
        if (mode !== 'create' || !item?.ratingKey || room) return;
        let cancelled = false;
        setBusy(true);
        setError('');
        void getWatchTogetherClient()
            .create({
                ratingKey: item.ratingKey,
                serverId: String(item.serverId || ''),
                title: item.title || 'Watch Together',
                type: item.type || 'movie',
                thumb: item.thumb || null,
                positionMs: Number(item.viewOffsetMs) || 0,
            })
            .then((state) => {
                if (!cancelled) setRoom(state);
            })
            .catch((err: any) => {
                if (!cancelled) setError(String(err?.message || t('mediaPlayerPage.watchTogetherError')));
            })
            .finally(() => {
                if (!cancelled) setBusy(false);
            });
        return () => { cancelled = true; };
    }, [mode, item?.ratingKey, item?.serverId, item?.title, item?.type, item?.thumb, item?.viewOffsetMs, room, t]);

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
                const state = await getWatchTogetherClient().join(code);
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
    const code = room?.inviteCode || '';
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
            const state = await getWatchTogetherClient().join(next);
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

    return (
        <div
            className="flex min-h-full flex-col gap-6 px-4 py-6 md:px-8"
            data-tv-watch-together="1"
            data-tv-screen="1"
        >
            <div className="flex items-center gap-3">
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
                <p className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-100" role="alert">
                    {error}
                </p>
            ) : null}

            {showJoinForm ? (
                <form className="flex max-w-md flex-col gap-3" onSubmit={(e) => void onJoinSubmit(e)}>
                    <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                        {t('mediaPlayerPage.watchTogetherInviteCode')}
                        <input
                            ref={inputRef}
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                            data-tv-item="1"
                            data-tv-key="wt-code"
                            className="mt-2 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 font-mono text-2xl tracking-[0.35em] text-white outline-none focus:border-plex/70"
                            placeholder="ABC123"
                            autoComplete="off"
                            spellCheck={false}
                            maxLength={8}
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
                <div className="flex max-w-xl flex-col gap-5">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                            {t('mediaPlayerPage.watchTogetherInviteCode')}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <span className="font-mono text-3xl font-black tracking-[0.35em] text-white">
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
                                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-plex/20 text-sm font-bold text-plex">
                                        {(row.displayName || '?').slice(0, 1).toUpperCase()}
                                    </span>
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

            {busy && !room ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('mediaPlayerPage.watchTogetherConnecting')}
                </div>
            ) : null}
        </div>
    );
};
