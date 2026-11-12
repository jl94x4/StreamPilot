import React, { useCallback, useEffect, useRef, useState } from 'react';
import { posterSetsApi, type PosterSetsArchivedWatch } from './api';
import { askConfirm } from '../shared/confirm';
import type { PosterSetsWatch } from './types';

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';
const cardClass = 'space-y-2 rounded-xl border border-white/10 bg-black/20 p-4';
const DAY = 24 * 60 * 60 * 1000;

const isLibraryPending = (message?: string | null) => {
    const text = String(message || '').toLowerCase();
    return text.includes('waiting for title in library') || text.includes('will auto-apply when');
};

type Attention = { watch: PosterSetsWatch; reason: string; tone: 'red' | 'amber' | 'muted' };

const attentionFor = (watches: PosterSetsWatch[]): Attention[] => {
    const out: Attention[] = [];
    for (const watch of watches) {
        if (watch.lastError && isLibraryPending(watch.lastError)) {
            out.push({ watch, reason: 'Waiting for this title to arrive in your library', tone: 'amber' });
        } else if (watch.lastError) {
            out.push({ watch, reason: watch.lastError, tone: 'red' });
        } else if (watch.enabled === false) {
            out.push({ watch, reason: 'Paused', tone: 'muted' });
        } else {
            const checked = Date.parse(watch.lastCheckedAt || '') || 0;
            if (!checked || Date.now() - checked > 14 * DAY) {
                out.push({ watch, reason: checked ? 'Not checked for over 2 weeks' : 'Never checked', tone: 'amber' });
            }
        }
    }
    const rank = { red: 0, amber: 1, muted: 2 } as const;
    return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
};

const toneClass = { red: 'text-red-300', amber: 'text-amber-200', muted: 'text-muted' } as const;
const labelOf = (watch: PosterSetsWatch) => String(watch.title || watch.plexHint?.title || watch.url || 'Untitled').trim();

export const WatchingToolsPanel: React.FC<{
    watches: PosterSetsWatch[];
    toast: (message: string, kind?: 'success' | 'error') => void;
    reload: () => Promise<void> | void;
    checkNow: (watch: PosterSetsWatch) => Promise<void> | void;
}> = ({ watches, toast, reload, checkNow }) => {
    const [pause, setPause] = useState<{ paused: boolean; until: string | null }>({ paused: false, until: null });
    const [archive, setArchive] = useState<PosterSetsArchivedWatch[]>([]);
    const [dupes, setDupes] = useState<PosterSetsWatch[][]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [showAttention, setShowAttention] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const refresh = useCallback(async () => {
        const [p, a, d] = await Promise.allSettled([
            posterSetsApi.watchPause(),
            posterSetsApi.watchArchive(),
            posterSetsApi.watchDuplicates(),
        ]);
        if (p.status === 'fulfilled') setPause({ paused: p.value.paused, until: p.value.until });
        if (a.status === 'fulfilled') setArchive(a.value.entries || []);
        if (d.status === 'fulfilled') setDupes(d.value.groups || []);
    }, []);

    useEffect(() => { void refresh(); }, [refresh, watches.length]);

    const run = async (key: string, fn: () => Promise<void>) => {
        setBusy(key);
        try {
            await fn();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Something went wrong', 'error');
        } finally {
            setBusy(null);
        }
    };

    const setPauseDays = (days: number) => run('pause', async () => {
        const response = await posterSetsApi.setWatchPause(days);
        setPause({ paused: response.paused, until: response.until });
        toast(days ? `Watchers paused for ${days} day${days === 1 ? '' : 's'}` : 'Watchers resumed');
    });

    const restore = (entry: PosterSetsArchivedWatch) => run(entry.id, async () => {
        await posterSetsApi.restoreArchivedWatch(entry.id);
        toast(`Restored ${labelOf(entry.watch)}`);
        await reload();
        await refresh();
    });

    const cleanDupes = () => run('dupes', async () => {
        const many = dupes.length !== 1;
        const ok = await askConfirm(
            `${dupes.length} ${many ? 'titles have' : 'title has'} more than one watched set. Keep the locked or most recently applied set for each and remove the rest? Removed sets can be restored from Recently replaced for 7 days.`,
            { title: 'Clean up duplicates?', confirmLabel: 'Keep newest', danger: true },
        );
        if (!ok) return;
        const response = await posterSetsApi.resolveWatchDuplicates();
        toast(`Removed ${response.removed} duplicate${response.removed === 1 ? '' : 's'}`);
        await reload();
        await refresh();
    });

    const exportFile = () => run('export', async () => {
        const data = await posterSetsApi.exportWatches();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `poster-sets-watching-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast('Watching list exported');
    });

    const importFile = (file: File | undefined) => {
        if (!file) return;
        void run('import', async () => {
            let payload: unknown;
            try {
                payload = JSON.parse(await file.text());
            } catch {
                throw new Error('That file is not a valid Watching export.');
            }
            const response = await posterSetsApi.importWatches(payload);
            const skipped = response.skippedSame + response.skippedTitle;
            toast(`Imported ${response.added} set${response.added === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped: already watched)` : ''}`);
            await reload();
            await refresh();
        });
    };

    const attention = attentionFor(watches);

    return (
        <div className="grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
                <h3 className="text-sm font-bold text-text">Watchers</h3>
                <p className="text-xs text-muted">
                    {pause.paused && pause.until
                        ? `Paused until ${new Date(pause.until).toLocaleString()}. Nothing new is queued while paused.`
                        : 'Pause automatic checks while you reorganise a library, so art does not change underneath you.'}
                </p>
                <div className="flex flex-wrap gap-2">
                    {pause.paused ? (
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void setPauseDays(0)}>Resume now</button>
                    ) : [1, 7, 30].map((days) => (
                        <button key={days} type="button" className={buttonClass} disabled={busy !== null} onClick={() => void setPauseDays(days)}>
                            Pause {days === 1 ? '1 day' : `${days} days`}
                        </button>
                    ))}
                </div>
            </div>

            <div className={cardClass}>
                <h3 className="text-sm font-bold text-text">Back up or move</h3>
                <p className="text-xs text-muted">Download the whole Watching list as a file, or load one back in. Titles you already watch are left alone.</p>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void exportFile()}>Export</button>
                    <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => fileRef.current?.click()}>Import…</button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={(event) => {
                            importFile(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                </div>
            </div>

            <div className={`${cardClass} md:col-span-2`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-text">
                        Needs attention {attention.length ? `· ${attention.length}` : ''}
                    </h3>
                    {attention.length ? (
                        <button type="button" className={buttonClass} onClick={() => setShowAttention((open) => !open)}>
                            {showAttention ? 'Hide' : 'Show'}
                        </button>
                    ) : null}
                </div>
                {!attention.length ? (
                    <p className="text-xs text-muted">Everything is being checked and nothing has errors.</p>
                ) : showAttention ? (
                    <ul className="max-h-72 divide-y divide-white/10 overflow-y-auto">
                        {attention.map(({ watch, reason, tone }) => (
                            <li key={watch.id} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm text-text">{labelOf(watch)}</p>
                                    <p className={`line-clamp-2 break-words text-xs ${toneClass[tone]}`}>{reason}</p>
                                </div>
                                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void checkNow(watch)}>Check</button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted">
                        {attention.filter((row) => row.tone === 'red').length} with errors ·{' '}
                        {attention.filter((row) => row.tone === 'amber').length} waiting or stale ·{' '}
                        {attention.filter((row) => row.tone === 'muted').length} paused
                    </p>
                )}
            </div>

            {dupes.length ? (
                <div className={`${cardClass} md:col-span-2 border-amber-500/30 bg-amber-500/10`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-sm font-bold text-amber-100">
                                {dupes.length} {dupes.length === 1 ? 'title has' : 'titles have'} more than one watched set
                            </h3>
                            <p className="text-xs text-amber-100/80">{dupes.slice(0, 4).map((group) => labelOf(group[0])).join(', ')}{dupes.length > 4 ? '…' : ''}</p>
                        </div>
                        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void cleanDupes()}>Keep newest</button>
                    </div>
                </div>
            ) : null}

            {archive.length ? (
                <div className={`${cardClass} md:col-span-2`}>
                    <h3 className="text-sm font-bold text-text">Recently replaced</h3>
                    <p className="text-xs text-muted">Sets that were replaced or removed as duplicates in the last 7 days. Restoring one swaps it back in.</p>
                    <ul className="max-h-60 divide-y divide-white/10 overflow-y-auto">
                        {archive.map((entry) => (
                            <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm text-text">{labelOf(entry.watch)}</p>
                                    <p className="text-xs text-muted">
                                        {entry.reason === 'duplicate' ? 'Removed as a duplicate' : 'Replaced'}
                                        {entry.replacedByTitle ? ` by a set for ${entry.replacedByTitle}` : ''} · {new Date(entry.removedAt).toLocaleString()}
                                    </p>
                                </div>
                                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void restore(entry)}>
                                    {busy === entry.id ? 'Restoring…' : 'Restore'}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};
