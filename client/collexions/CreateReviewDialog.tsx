import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, type CreateOptions, type CreatePreview, type CreatePreviewRequest } from './api';

const INTERVALS = [
    { value: 0, label: 'Every 6 hours (default)' },
    { value: 1, label: 'Every hour' },
    { value: 12, label: 'Every 12 hours' },
    { value: 24, label: 'Daily' },
    { value: 72, label: 'Every 3 days' },
    { value: 168, label: 'Weekly' },
    { value: 720, label: 'Monthly' },
];

const fieldClass = 'w-full rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-sm text-text outline-none focus:border-plex';
const labelClass = 'text-[11px] font-bold uppercase tracking-wide text-muted';

export type ReviewRequest = CreatePreviewRequest & {
    /** Whether this collection will register an auto-sync job (shows sync options). */
    autoSync: boolean;
    heading?: string;
};

const Dialog: React.FC<{ request: ReviewRequest; onDone: (options: CreateOptions | null) => void }> = ({ request, onDone }) => {
    const [preview, setPreview] = useState<CreatePreview | null>(null);
    const [error, setError] = useState('');
    const [showMissing, setShowMissing] = useState(false);
    const [minItems, setMinItems] = useState('');
    const [interval, setIntervalHours] = useState(0);
    const [excludePins, setExcludePins] = useState(false);
    const [poster, setPoster] = useState<'auto' | 'plex' | 'item'>('auto');
    const [posterKey, setPosterKey] = useState('');

    useEffect(() => {
        let cancelled = false;
        api.previewCreate({
            library: request.library,
            title: request.title,
            template_id: request.template_id,
            source_type: request.source_type,
            source_id: request.source_id,
            items: request.items,
            item_keys: request.item_keys,
        })
            .then((result) => { if (!cancelled) setPreview(result); })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not preview this source.'); });
        return () => { cancelled = true; };
    }, [request]);

    const conflicts = preview?.conflicts || [];
    const nothingMatches = Boolean(preview && preview.matched_count === 0);
    const minNumber = Math.max(0, Number(minItems) || 0);
    const belowMinimum = Boolean(preview && minNumber > 0 && preview.matched_count < minNumber);

    const confirm = () => {
        const options: CreateOptions = {
            allow_overwrite: conflicts.length > 0,
            ...(minNumber ? { min_items: minNumber } : {}),
            ...(request.autoSync && interval ? { interval_hours: interval } : {}),
            ...(excludePins ? { exclude_from_pinning: true } : {}),
            ...(poster !== 'auto' ? { poster } : {}),
            ...(poster === 'item' && posterKey ? { poster_item_key: posterKey } : {}),
        };
        onDone(options);
    };

    const createLabel = conflicts.length ? 'Create anyway' : 'Create collection';
    const pct = preview && preview.total ? Math.round((preview.matched_count / preview.total) * 100) : 0;

    return (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => onDone(null)}>
            <div
                role="dialog"
                aria-modal="true"
                className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="border-b border-white/10 px-5 py-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-plex">{request.heading || 'Review before creating'}</p>
                    <h3 className="mt-1 truncate text-base font-bold text-text">{preview?.title || request.title || 'New collection'}</h3>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    {!preview && !error ? (
                        <p className="text-sm text-muted">Checking what matches your library…</p>
                    ) : null}

                    {error ? (
                        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                            {error}
                            <p className="mt-1 text-xs text-red-200/80">You can still create it without a preview.</p>
                        </div>
                    ) : null}

                    {preview ? (
                        <>
                            <div className="space-y-2">
                                <div className="flex items-baseline justify-between gap-3">
                                    <p className="text-sm text-text">
                                        <span className="text-2xl font-black text-plex">{preview.matched_count}</span>
                                        <span className="text-muted"> of {preview.total} titles are in your library</span>
                                    </p>
                                    <span className="text-xs text-muted">{pct}%</span>
                                </div>
                                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                                    <div className="h-full rounded-full bg-plex" style={{ width: `${pct}%` }} />
                                </div>
                                {nothingMatches ? (
                                    <p className="text-xs text-red-300">Nothing in this source matches your library, so there is nothing to create.</p>
                                ) : null}
                                {preview.unmatched_count > 0 ? (
                                    <button type="button" className="text-xs font-semibold text-plex hover:underline" onClick={() => setShowMissing((v) => !v)}>
                                        {showMissing ? 'Hide' : 'Show'} {preview.unmatched_count} missing title{preview.unmatched_count === 1 ? '' : 's'}
                                    </button>
                                ) : null}
                                {showMissing ? (
                                    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-muted">
                                        {preview.unmatched.map((row, index) => (
                                            <li key={`${row.title}-${index}`}>{row.title}{row.year ? ` (${row.year})` : ''}</li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>

                            {conflicts.map((conflict, index) => (
                                <div key={`${conflict.kind}-${index}`} className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                                    {conflict.kind === 'same_name'
                                        ? `A collection called “${conflict.title}” already exists${typeof conflict.itemCount === 'number' ? ` (${conflict.itemCount} items)` : ''}. Creating this will overwrite its contents.`
                                        : `“${conflict.title}” already syncs from this same source. You would end up with two collections that fill from the same list.`}
                                </div>
                            ))}
                        </>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-1">
                            <span className={labelClass}>Minimum titles</span>
                            <input
                                className={fieldClass}
                                inputMode="numeric"
                                placeholder="No minimum"
                                value={minItems}
                                onChange={(event) => setMinItems(event.target.value.replace(/[^0-9]/g, ''))}
                            />
                            <span className="block text-[11px] text-muted">Skip creating, and later syncs, if fewer match.</span>
                        </label>
                        {request.autoSync ? (
                            <label className="block space-y-1">
                                <span className={labelClass}>Sync schedule</span>
                                <select className={fieldClass} value={interval} onChange={(event) => setIntervalHours(Number(event.target.value))}>
                                    {INTERVALS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </label>
                        ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-1">
                            <span className={labelClass}>Poster</span>
                            <select className={fieldClass} value={poster} onChange={(event) => setPoster(event.target.value as 'auto' | 'plex' | 'item')}>
                                <option value="auto">Automatic (franchise art or mosaic)</option>
                                <option value="plex">Leave it to Plex</option>
                                <option value="item" disabled={!preview?.matched.length}>Use a title’s poster…</option>
                            </select>
                        </label>
                        {poster === 'item' ? (
                            <label className="block space-y-1">
                                <span className={labelClass}>Which title</span>
                                <select className={fieldClass} value={posterKey} onChange={(event) => setPosterKey(event.target.value)}>
                                    <option value="">Choose…</option>
                                    {(preview?.matched || []).map((row) => (
                                        <option key={row.rating_key} value={row.rating_key}>{row.title}{row.year ? ` (${row.year})` : ''}</option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                    </div>

                    <label className="flex items-start gap-2 text-sm text-text">
                        <input type="checkbox" className="mt-1" checked={excludePins} onChange={(event) => setExcludePins(event.target.checked)} />
                        <span>
                            Keep it out of automatic pinning
                            <span className="block text-[11px] text-muted">Adds it to the exclusion list so it is never pinned to the home screen.</span>
                        </span>
                    </label>
                </div>

                <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
                    <button type="button" className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-text hover:bg-white/5" onClick={() => onDone(null)}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="rounded-xl bg-plex px-4 py-2 text-sm font-bold text-background transition hover:bg-plex-hover disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={(!preview && !error) || nothingMatches || belowMinimum || (poster === 'item' && !posterKey)}
                        onClick={confirm}
                    >
                        {belowMinimum ? `Below minimum (${minNumber})` : (error ? 'Create anyway' : createLabel)}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** Dry run + options before anything is created. Resolves the chosen options, or null if cancelled. */
export const reviewBeforeCreate = (request: ReviewRequest): Promise<CreateOptions | null> => (
    new Promise((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        const finish = (options: CreateOptions | null) => {
            root.unmount();
            host.remove();
            resolve(options);
        };
        root.render(<Dialog request={request} onDone={finish} />);
    })
);
