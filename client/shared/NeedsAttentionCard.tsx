import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, OctagonAlert, RefreshCw } from 'lucide-react';
import { apiFetch } from './api';
import { usePoll } from './usePoll';

type AttentionItem = {
    key: string;
    severity: 'critical' | 'warning';
    title: string;
    detail?: string;
    link?: string;
    since?: number;
    count?: number;
};

type Props = {
    onNavigate?: (route: string) => void;
};

const COLLAPSED_KEY = 'portal-needs-attention-collapsed';

const readCollapsed = () => {
    try {
        return window.localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch {
        return false;
    }
};

/** Admin home: one list of everything that is broken or failing right now. Hidden when all is well. */
export const NeedsAttentionCard: React.FC<Props> = ({ onNavigate }) => {
    const [items, setItems] = useState<AttentionItem[] | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [collapsed, setCollapsed] = useState(readCollapsed);

    const load = useCallback(async (refresh = false) => {
        setBusy(true);
        try {
            const data = await apiFetch(`/api/admin/attention${refresh ? '?refresh=1' : ''}`);
            if (data?.error) throw new Error(data.error);
            setItems(Array.isArray(data?.items) ? data.items : []);
            setError('');
        } catch (e: any) {
            // Do not hide a failing check behind an empty card.
            setError(String(e?.message || 'Could not run the health checks'));
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);
    usePoll(() => { void load(); }, 60_000, { immediate: false });

    const toggle = () => {
        setCollapsed((prev) => {
            const next = !prev;
            try { window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    if (!error && (!items || items.length === 0)) return null;

    const critical = (items || []).filter((item) => item.severity === 'critical').length;
    const total = items?.length || 0;

    return (
        <section className="mb-8 w-full rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-4" aria-label="Needs attention">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={!collapsed}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    {critical > 0 ? (
                        <OctagonAlert className="h-5 w-5 shrink-0 text-red-400" />
                    ) : (
                        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" />
                    )}
                    <span className="min-w-0 truncate text-sm font-black text-text">
                        {error && total === 0
                            ? 'Health checks could not run'
                            : `Needs attention (${total})`}
                    </span>
                    {collapsed ? <ChevronDown className="h-4 w-4 shrink-0 text-muted" /> : <ChevronUp className="h-4 w-4 shrink-0 text-muted" />}
                </button>
                <button
                    type="button"
                    onClick={() => void load(true)}
                    disabled={busy}
                    aria-label="Re-run checks"
                    className="rounded-lg border border-white/10 p-1.5 text-muted transition-colors hover:text-text disabled:opacity-50"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                </button>
            </div>
            {!collapsed && (
                <ul className="mt-3 flex flex-col gap-2">
                    {error ? (
                        <li className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-amber-200">{error}</li>
                    ) : null}
                    {(items || []).map((item) => (
                        <li
                            key={item.key}
                            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                                item.severity === 'critical'
                                    ? 'border-red-500/30 bg-red-500/10'
                                    : 'border-white/10 bg-black/20'
                            }`}
                        >
                            <span
                                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.severity === 'critical' ? 'bg-red-400' : 'bg-amber-300'}`}
                                aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-text">{item.title}</p>
                                {item.detail ? <p className="mt-0.5 break-words text-xs text-muted">{item.detail}</p> : null}
                                {item.count && item.count > 1 ? (
                                    <p className="mt-0.5 text-[11px] text-muted/70">Happened {item.count} times</p>
                                ) : null}
                            </div>
                            {item.link && onNavigate ? (
                                <button
                                    type="button"
                                    onClick={() => onNavigate(item.link!)}
                                    className="shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-bold text-text/80 hover:bg-white/5"
                                >
                                    Open
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};
