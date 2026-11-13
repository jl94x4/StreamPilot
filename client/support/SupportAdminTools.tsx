import React, { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { apiFetch } from '../shared/api';

const STORAGE_KEY = 'support.cannedReplies.v1';

const DEFAULT_SNIPPETS = [
    { id: 'd-checking', label: 'Looking into it', text: "Thanks for letting us know — I'm looking into this now and will update you here." },
    { id: 'd-info', label: 'Need more info', text: 'Could you tell us a bit more (which title, which device, and roughly when it happened)? That will help us track it down.' },
    { id: 'd-fixed', label: 'Fixed', text: 'This should be fixed now. Please try again and let us know if it still happens.' },
    { id: 'd-queue', label: 'In the queue', text: "It's in our queue and will show up once it has finished downloading." },
];

type Snippet = { id: string; label: string; text: string };

const loadSnippets = (): Snippet[] => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SNIPPETS;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((item) => item && typeof item.text === 'string')) return parsed;
    } catch { /* ignore */ }
    return DEFAULT_SNIPPETS;
};

const saveSnippets = (items: Snippet[]) => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* ignore */ }
};

/** Admin-only quick replies. Kept per browser; the first words of a draft can be saved as a new snippet. */
export const CannedReplies: React.FC<{ draft: string; onInsert: (text: string) => void }> = ({ draft, onInsert }) => {
    const [items, setItems] = useState<Snippet[]>(loadSnippets);

    const update = (next: Snippet[]) => {
        setItems(next);
        saveSnippets(next);
    };

    const saveDraft = () => {
        const text = draft.trim();
        if (!text) return;
        const label = text.replace(/\s+/g, ' ').slice(0, 24);
        update([...items, { id: `c-${Date.now()}`, label, text }].slice(-12));
    };

    return (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Quick replies">
            {items.map((item) => (
                <span key={item.id} className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] text-[11px] font-semibold text-muted">
                    <button
                        type="button"
                        onClick={() => onInsert(item.text)}
                        title={item.text}
                        className="rounded-l-full px-2.5 py-1 hover:text-text"
                    >
                        {item.label}
                    </button>
                    <button
                        type="button"
                        onClick={() => update(items.filter((entry) => entry.id !== item.id))}
                        aria-label={`Remove quick reply ${item.label}`}
                        className="rounded-r-full px-1.5 py-1 hover:text-red-300"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </span>
            ))}
            <button
                type="button"
                onClick={saveDraft}
                disabled={!draft.trim()}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[11px] font-semibold text-muted hover:text-text disabled:opacity-40"
                title="Save what you have typed as a quick reply"
            >
                <Plus className="h-3 w-3" /> Save draft
            </button>
        </div>
    );
};

type MemberRequest = {
    id: string | number;
    title: string;
    year?: number | string | null;
    type?: string;
    statusLabel?: string;
};

/** Admin-only: the member's latest requests, so a ticket can be answered with context. */
export const MemberRequestsPanel: React.FC<{ userId?: string | null; name?: string }> = ({ userId, name }) => {
    const [rows, setRows] = useState<MemberRequest[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setRows(null);
        setFailed(false);
        if (!userId) return;
        let cancelled = false;
        apiFetch(`/api/admin/member-requests?userId=${encodeURIComponent(String(userId))}`)
            .then((data) => { if (!cancelled) setRows(Array.isArray(data?.results) ? data.results : []); })
            .catch(() => { if (!cancelled) setFailed(true); });
        return () => { cancelled = true; };
    }, [userId]);

    if (!userId || (!failed && (!rows || rows.length === 0))) return null;

    return (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">
                Recent requests{name ? ` from ${name}` : ''}
            </p>
            {failed ? (
                <p className="mt-1 text-xs text-muted">Could not load this member's requests.</p>
            ) : (
                <ul className="mt-1.5 space-y-1">
                    {(rows || []).map((row) => (
                        <li key={String(row.id)} className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 truncate text-text">
                                {row.title}{row.year ? ` (${row.year})` : ''}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">{row.statusLabel || ''}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
