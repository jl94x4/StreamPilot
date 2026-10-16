import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileVideo, Folder, FolderOpen, Loader2, RefreshCw } from 'lucide-react';
import { mediaAutomationApi, type MediaAutomationBrowseEntry, type MediaAutomationBrowseResult } from './api';

const fieldClass = 'w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-white/[0.04] px-3 py-2 text-sm font-semibold text-text transition hover:border-plex/50 hover:bg-plex/10 disabled:pointer-events-none disabled:opacity-40';
const primaryButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-plex px-3 py-2 text-sm font-bold text-background transition hover:bg-plex-hover disabled:pointer-events-none disabled:opacity-40';

const PAGE_SIZE = 400;

const normalizePathKey = (value: string) => String(value || '')
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();

const browseTargetFromValue = (raw: string, pickFiles: boolean) => {
    const start = String(raw || '').trim();
    if (!start) return '';
    if (pickFiles && /\.[a-z0-9]+$/i.test(start)) {
        return start.replace(/[/\\][^/\\]+$/, '');
    }
    return start;
};

type Props = {
    label?: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    optional?: boolean;
    /** directory = pick folders; file = pick media files under mounts */
    mode?: 'directory' | 'file';
    extensions?: string[];
    hint?: string;
};

export const PathBrowserField: React.FC<Props> = ({
    label,
    value,
    onChange,
    placeholder,
    optional = false,
    mode = 'directory',
    extensions,
    hint,
}) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [listing, setListing] = useState<MediaAutomationBrowseResult | null>(null);
    const [entries, setEntries] = useState<MediaAutomationBrowseEntry[]>([]);
    const [cursor, setCursor] = useState('');
    const [filter, setFilter] = useState('');
    const [filterDraft, setFilterDraft] = useState('');
    const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const valueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const requestId = useRef(0);
    const cursorRef = useRef('');
    const valueRef = useRef(value);
    const openRef = useRef(open);
    const pickFiles = mode === 'file';

    useEffect(() => {
        cursorRef.current = cursor;
    }, [cursor]);

    useEffect(() => {
        valueRef.current = value;
    }, [value]);

    useEffect(() => {
        openRef.current = open;
    }, [open]);

    const load = useCallback(async (nextPath = '', {
        append = false,
        offset = 0,
        q = filter,
        softFailure = false,
        resetFilter = false,
    }: {
        append?: boolean;
        offset?: number;
        q?: string;
        softFailure?: boolean;
        resetFilter?: boolean;
    } = {}) => {
        const id = ++requestId.current;
        setBusy(true);
        if (!softFailure) setError('');
        if (resetFilter) {
            setFilter('');
            setFilterDraft('');
        }
        try {
            const result = await mediaAutomationApi.browse(nextPath, {
                files: pickFiles,
                extensions,
                limit: PAGE_SIZE,
                offset,
                q: q || undefined,
            });
            if (id !== requestId.current) return;
            setListing(result);
            setCursor(result.path || '');
            setEntries((current) => (append ? [...current, ...(result.entries || [])] : (result.entries || [])));
            setError(result.message && !result.roots?.length ? result.message : '');
        } catch (err) {
            if (id !== requestId.current) return;
            const message = err instanceof Error ? err.message : 'Failed to browse';
            if (softFailure) {
                // Keep the current listing while the typed path is incomplete / missing.
                setError(message);
                return;
            }
            if (nextPath && !append) {
                try {
                    const fallback = await mediaAutomationApi.browse('', { files: pickFiles, extensions });
                    if (id !== requestId.current) return;
                    setListing(fallback);
                    setCursor('');
                    setEntries(fallback.entries || []);
                    setError('Path not browsable - pick a mount root');
                    return;
                } catch {
                    // fall through
                }
            }
            setError(message);
        } finally {
            if (id === requestId.current) setBusy(false);
        }
    }, [extensions, filter, pickFiles]);

    // Initial listing when the browser panel opens.
    useEffect(() => {
        if (!open) return;
        const target = browseTargetFromValue(valueRef.current, pickFiles);
        setEntries([]);
        void load(target, { q: '', resetFilter: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Typing/pasting into the path field while open navigates the listing.
    // Depends on value only (open via ref) so click-navigation does not bounce back.
    useEffect(() => {
        if (!openRef.current) return;
        if (valueTimer.current) clearTimeout(valueTimer.current);

        const target = browseTargetFromValue(value, pickFiles);
        if (normalizePathKey(target) === normalizePathKey(cursorRef.current)) return;

        valueTimer.current = setTimeout(() => {
            if (!openRef.current) return;
            setEntries([]);
            void load(target, { q: '', softFailure: true, resetFilter: true });
        }, 350);

        return () => {
            if (valueTimer.current) clearTimeout(valueTimer.current);
        };
    }, [value, pickFiles, load]);

    useEffect(() => () => {
        if (filterTimer.current) clearTimeout(filterTimer.current);
        if (valueTimer.current) clearTimeout(valueTimer.current);
    }, []);

    const applyFilter = (next: string) => {
        setFilterDraft(next);
        if (filterTimer.current) clearTimeout(filterTimer.current);
        filterTimer.current = setTimeout(() => {
            setFilter(next);
            setEntries([]);
            void load(cursorRef.current || '', { q: next, offset: 0 });
        }, 250);
    };

    const crumbs = (() => {
        if (!listing?.path || !listing.root) return [] as string[];
        const relative = listing.path === listing.root
            ? ''
            : listing.path.slice(listing.root.length).replace(/^[/\\]+/, '');
        const parts = relative ? relative.split(/[/\\]+/).filter(Boolean) : [];
        const items = [listing.root];
        let built = listing.root;
        for (const part of parts) {
            built = `${built.replace(/[/\\]+$/, '')}/${part}`;
            items.push(built);
        }
        return items;
    })();

    const selectPath = (next: string) => {
        onChange(next);
        setOpen(false);
    };

    const navigate = (nextPath: string) => {
        setEntries([]);
        void load(nextPath, { q: '', resetFilter: true });
    };

    const total = listing?.total ?? entries.length;
    const hasMore = !!listing?.hasMore;

    return (
        <div className="space-y-2">
            {(label || true) && (
                <div className="flex items-center justify-between gap-2">
                    {label ? <label className="text-sm font-semibold text-text">{label}{optional ? ' (optional)' : ''}</label> : <span />}
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setOpen((current) => !current)}
                    >
                        {open ? <FolderOpen className="h-4 w-4" /> : <Folder className="h-4 w-4" />}
                        {open ? 'Hide browser' : (pickFiles ? 'Browse files' : 'Browse')}
                    </button>
                </div>
            )}
            <input
                className={fieldClass}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
            />
            {hint && <p className="text-xs text-muted">{hint}</p>}
            {open && (
                <div className="rounded-xl border border-border bg-background/40 p-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy || !listing?.parent}
                            onClick={() => listing?.parent && navigate(listing.parent)}
                        >
                            <ChevronLeft className="h-4 w-4" /> Up
                        </button>
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => {
                                setEntries([]);
                                void load(cursor || '', { q: filter });
                            }}
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
                        </button>
                        {!pickFiles && (
                            <>
                                <button
                                    type="button"
                                    className={primaryButtonClass}
                                    disabled={!cursor}
                                    onClick={() => cursor && selectPath(cursor)}
                                >
                                    Use this folder
                                </button>
                                {!!String(value || '').trim() && (
                                    <button
                                        type="button"
                                        className={buttonClass}
                                        onClick={() => selectPath(String(value).trim())}
                                    >
                                        Use typed path
                                    </button>
                                )}
                            </>
                        )}
                        {optional && value && (
                            <button type="button" className={buttonClass} onClick={() => onChange('')}>
                                Clear
                            </button>
                        )}
                    </div>
                    {crumbs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                            {crumbs.map((crumb, index) => (
                                <React.Fragment key={crumb}>
                                    {index > 0 && <ChevronRight className="h-3 w-3" />}
                                    <button
                                        type="button"
                                        className="rounded px-1.5 py-0.5 font-mono hover:bg-plex/15 hover:text-plex"
                                        onClick={() => navigate(crumb)}
                                    >
                                        {index === 0 ? crumb : crumb.split(/[/\\]/).filter(Boolean).pop()}
                                    </button>
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                    {!!listing?.path && (
                        <input
                            className={fieldClass}
                            value={filterDraft}
                            onChange={(event) => applyFilter(event.target.value)}
                            placeholder={pickFiles ? 'Filter files…' : 'Filter folders…'}
                            aria-label="Filter browse entries"
                        />
                    )}
                    {!listing?.path && (listing?.roots?.length || 0) > 0 && (
                        <p className="text-xs text-muted">
                            {pickFiles
                                ? 'Open a mount, then click a media file. Use container paths (e.g. /media or /output), not Unraid /mnt/… paths.'
                                : 'Pick a mount below, or type any existing container path (e.g. /output) and Use typed path.'}
                        </p>
                    )}
                    {!listing?.path && !(listing?.roots?.length) && !busy && (
                        <p className="text-xs text-amber-200">
                            No mounts discovered yet. Type a container path that exists (e.g. /output or /media/processed) and use Use typed path.
                        </p>
                    )}
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 bg-card/40 custom-scrollbar">
                        {busy && entries.length === 0 ? (
                            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-plex" /></div>
                        ) : entries.length === 0 ? (
                            <p className="p-4 text-sm text-muted">
                                {error || (filter
                                    ? 'No matches for that filter.'
                                    : (pickFiles ? 'No media files in this folder.' : 'No folders here.'))}
                            </p>
                        ) : (
                            <ul className="divide-y divide-border/50">
                                {entries.map((entry) => {
                                    const isFile = entry.type === 'file';
                                    return (
                                        <li key={entry.path}>
                                            <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text transition hover:bg-plex/10"
                                                onClick={() => {
                                                    if (isFile) selectPath(entry.path);
                                                    else navigate(entry.path);
                                                }}
                                            >
                                                {isFile
                                                    ? <FileVideo className="h-4 w-4 shrink-0 text-plex" />
                                                    : <Folder className="h-4 w-4 shrink-0 text-plex" />}
                                                <span className="truncate font-mono text-xs sm:text-sm">{entry.name}</span>
                                                {isFile && <span className="ml-auto text-[10px] uppercase text-muted">Select</span>}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                    {!!listing?.path && total > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                            <p>
                                Showing {entries.length} of {total}
                                {filter ? ` matching “${filter}”` : ''}
                            </p>
                            {hasMore && (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    disabled={busy}
                                    onClick={() => void load(cursor || '', {
                                        append: true,
                                        offset: entries.length,
                                        q: filter,
                                    })}
                                >
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                    Load more
                                </button>
                            )}
                        </div>
                    )}
                    {cursor && <p className="break-all font-mono text-[11px] text-muted">Folder: {cursor}</p>}
                    {error ? <p className="text-xs text-amber-200">{error}</p> : null}
                </div>
            )}
        </div>
    );
};
