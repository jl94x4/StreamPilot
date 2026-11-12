import React, { useCallback, useEffect, useState } from 'react';
import { api, COLLEXIONS_CREATED_EVENT } from './api';
import { askConfirm } from '../shared/confirm';

type Created = { title: string; library: string; ratingKey: string; at: number };

const STORAGE_KEY = 'collexions.justCreated';
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX = 8;

const read = (): Created[] => {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
        return (Array.isArray(parsed) ? parsed : [])
            .filter((row: Created) => row && row.ratingKey && Date.now() - Number(row.at || 0) < KEEP_MS)
            .slice(0, MAX);
    } catch {
        return [];
    }
};

const write = (rows: Created[]) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows)); } catch { /* ignore */ }
};

/** Brand-new collections made in the last day, each with an Undo that removes it and its sync job. */
export const JustCreatedCard: React.FC<{ onMessage: (text: string, kind: 'success' | 'error') => void }> = ({ onMessage }) => {
    const [rows, setRows] = useState<Created[]>(() => read());
    const [busy, setBusy] = useState<string | null>(null);

    useEffect(() => {
        const onCreated = (event: Event) => {
            const detail = (event as CustomEvent<Created>).detail;
            if (!detail?.ratingKey) return;
            setRows((current) => {
                const next = [detail, ...current.filter((row) => row.ratingKey !== detail.ratingKey)].slice(0, MAX);
                write(next);
                return next;
            });
        };
        window.addEventListener(COLLEXIONS_CREATED_EVENT, onCreated);
        return () => window.removeEventListener(COLLEXIONS_CREATED_EVENT, onCreated);
    }, []);

    const remove = useCallback((ratingKey: string) => {
        setRows((current) => {
            const next = current.filter((row) => row.ratingKey !== ratingKey);
            write(next);
            return next;
        });
    }, []);

    const undo = async (row: Created) => {
        const ok = await askConfirm(
            `Remove “${row.title}” from ${row.library}? The collection and its auto-sync job are deleted. The titles themselves stay in your library.`,
            { title: 'Undo creation?', confirmLabel: 'Remove collection', danger: true },
        );
        if (!ok) return;
        setBusy(row.ratingKey);
        try {
            await api.deleteCollection(row.title, row.library, row.ratingKey);
            remove(row.ratingKey);
            onMessage(`Removed “${row.title}”`, 'success');
        } catch (error) {
            onMessage(error instanceof Error ? error.message : 'Could not remove it', 'error');
        } finally {
            setBusy(null);
        }
    };

    if (!rows.length) return null;

    return (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4">
            <h3 className="text-sm font-bold text-text">Just created</h3>
            <p className="text-xs text-muted">Not what you wanted? Undo removes the new collection and its sync job.</p>
            <ul className="divide-y divide-white/10">
                {rows.map((row) => (
                    <li key={row.ratingKey} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                            <p className="truncate text-sm text-text">{row.title}</p>
                            <p className="text-xs text-muted">{row.library} · {new Date(row.at).toLocaleTimeString()}</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <button
                                type="button"
                                className="rounded-xl border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-semibold text-text hover:bg-white/5 disabled:opacity-40"
                                disabled={busy !== null}
                                onClick={() => void undo(row)}
                            >
                                {busy === row.ratingKey ? 'Removing…' : 'Undo'}
                            </button>
                            <button
                                type="button"
                                className="rounded-xl px-2 py-1.5 text-xs text-muted hover:text-text"
                                aria-label="Dismiss"
                                onClick={() => remove(row.ratingKey)}
                            >
                                ✕
                            </button>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};
