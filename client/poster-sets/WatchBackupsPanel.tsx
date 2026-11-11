import React, { useCallback, useEffect, useState } from 'react';
import { posterSetsApi, type PosterSetsWatchBackup } from './api';
import { askConfirm } from '../shared/confirm';

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';

const labelFor = (backup: PosterSetsWatchBackup) => {
    if (backup.kind === 'before-restore') {
        return `Saved before a restore · ${new Date(backup.savedAt).toLocaleString()}`;
    }
    return backup.date ? new Date(`${backup.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : backup.name;
};

export const WatchBackupsPanel: React.FC<{
    toast: (message: string, kind?: 'success' | 'error') => void;
    onRestored?: () => void;
}> = ({ toast, onRestored }) => {
    const [backups, setBackups] = useState<PosterSetsWatchBackup[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const response = await posterSetsApi.watchBackups();
            setBackups(response.backups || []);
        } catch { /* leave the list as it was */ }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const backupNow = async () => {
        setBusy('now');
        try {
            const response = await posterSetsApi.backupWatchesNow();
            setBackups(response.backups || []);
            toast('Watching list backed up');
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Backup failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    const restore = async (backup: PosterSetsWatchBackup) => {
        const ok = await askConfirm(
            `Replace your current Watching list with the ${backup.count} watched set${backup.count === 1 ? '' : 's'} from this backup? Your current list is saved first, so you can undo this from the same list.`,
            { title: 'Restore watching list?', confirmLabel: 'Restore', danger: true },
        );
        if (!ok) return;
        setBusy(backup.name);
        try {
            const response = await posterSetsApi.restoreWatchBackup(backup.name);
            setBackups(response.backups || []);
            toast(`Restored ${response.restored} watched set${response.restored === 1 ? '' : 's'}`);
            onRestored?.();
        } catch (error) {
            toast(error instanceof Error ? error.message : 'Restore failed', 'error');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-bold text-text">Watching backups</h3>
                    <p className="text-xs text-muted">The Watching list is backed up once a day (last 14 days kept). Restore replaces the current list.</p>
                </div>
                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void backupNow()}>
                    {busy === 'now' ? 'Backing up…' : 'Back up now'}
                </button>
            </div>
            {backups.length ? (
                <ul className="divide-y divide-white/10">
                    {backups.map((backup) => (
                        <li key={backup.name} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm text-text">{labelFor(backup)}</p>
                                <p className="text-xs text-muted">{backup.count} watched set{backup.count === 1 ? '' : 's'}</p>
                            </div>
                            <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void restore(backup)}>
                                {busy === backup.name ? 'Restoring…' : 'Restore'}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-muted">No backups yet. The first one is written within a minute of the portal starting, once you are watching at least one set.</p>
            )}
        </div>
    );
};
