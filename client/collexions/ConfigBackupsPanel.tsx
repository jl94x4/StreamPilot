import React, { useCallback, useEffect, useState } from 'react';
import { api, type CollexionsConfigBackup } from './api';
import { askConfirm } from '../shared/confirm';

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40';

const labelFor = (backup: CollexionsConfigBackup) => {
    if (backup.kind === 'before-restore') return `Saved before a restore · ${new Date(backup.savedAt).toLocaleString()}`;
    return backup.date
        ? new Date(`${backup.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
        : backup.name;
};

export const ConfigBackupsPanel: React.FC = () => {
    const [backups, setBackups] = useState<CollexionsConfigBackup[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

    const load = useCallback(async () => {
        try {
            const response = await api.getConfigBackups();
            setBackups(response.backups || []);
        } catch { /* leave the list as it was */ }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const backupNow = async () => {
        setBusy('now');
        setMessage(null);
        try {
            const response = await api.backupConfigNow();
            setBackups(response.backups || []);
            setMessage({ text: 'Backed up' });
        } catch (error) {
            setMessage({ text: error instanceof Error ? error.message : 'Backup failed', error: true });
        } finally {
            setBusy(null);
        }
    };

    const restore = async (backup: CollexionsConfigBackup) => {
        const ok = await askConfirm(
            `Replace your current Collexions settings and ${backup.jobs} sync job${backup.jobs === 1 ? '' : 's'} with this backup? Your current setup is saved first, so you can undo this from the same list.`,
            { title: 'Restore backup?', confirmLabel: 'Restore', danger: true },
        );
        if (!ok) return;
        setBusy(backup.name);
        setMessage(null);
        try {
            await api.restoreConfigBackup(backup.name);
            setMessage({ text: 'Restored. Reloading…' });
            window.setTimeout(() => window.location.reload(), 800);
        } catch (error) {
            setMessage({ text: error instanceof Error ? error.message : 'Restore failed', error: true });
            setBusy(null);
        }
    };

    return (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-bold text-text">Backups</h3>
                    <p className="text-xs text-muted">Your settings (pin rules, exclusions, seasonal windows) and all sync jobs are backed up once a day. The last 14 days are kept.</p>
                </div>
                <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void backupNow()}>
                    {busy === 'now' ? 'Backing up…' : 'Back up now'}
                </button>
            </div>
            {message ? <p className={`text-xs ${message.error ? 'text-red-300' : 'text-plex'}`}>{message.text}</p> : null}
            {backups.length ? (
                <ul className="max-h-64 divide-y divide-white/10 overflow-y-auto">
                    {backups.map((backup) => (
                        <li key={backup.name} className="flex items-center justify-between gap-3 py-2">
                            <div className="min-w-0">
                                <p className="truncate text-sm text-text">{labelFor(backup)}</p>
                                <p className="text-xs text-muted">
                                    {backup.libraries} librar{backup.libraries === 1 ? 'y' : 'ies'} · {backup.jobs} sync job{backup.jobs === 1 ? '' : 's'}
                                </p>
                            </div>
                            <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void restore(backup)}>
                                {busy === backup.name ? 'Restoring…' : 'Restore'}
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-muted">No backups yet. The first one is written within ten minutes, once you have saved settings or created a sync job.</p>
            )}
        </div>
    );
};
