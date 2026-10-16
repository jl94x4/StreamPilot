import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, User } from 'lucide-react';
import type { PosterSetsConfig } from './types';

const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-plex px-2.5 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
const fieldClass = 'w-full appearance-none rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex sm:py-2.5';
const FOLLOWED_CREATORS_PANEL_KEY = 'posterSetsFollowedCreatorsOpen.v1';

const normalizeHandle = (value: string) => String(value || '').trim().replace(/^@+/, '');

export type PosterSetsCreatorsPanelProps = {
    creators: string[];
    busy?: string | null;
    onChange: (creators: string[]) => void;
    onSave: (config: Partial<PosterSetsConfig>) => Promise<void>;
    onOpenCreator?: (handle: string) => void;
    toast: (message: string, type?: 'success' | 'error') => void;
    /** When set, the follow list starts collapsed and can be toggled. */
    collapsible?: boolean;
};

export function PosterSetsCreatorsPanel({
    creators,
    busy,
    onChange,
    onSave,
    onOpenCreator,
    toast,
    collapsible = false,
}: PosterSetsCreatorsPanelProps) {
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(() => {
        if (!collapsible) return true;
        if (typeof window === 'undefined') return false;
        return window.localStorage.getItem(FOLLOWED_CREATORS_PANEL_KEY) === '1';
    });
    const inputRef = useRef<HTMLInputElement | null>(null);
    const sorted = useMemo(
        () => [...creators].map(normalizeHandle).filter(Boolean).sort((a, b) => a.localeCompare(b)),
        [creators],
    );
    const saveLocked = saving || busy === 'save';

    useEffect(() => {
        if (!collapsible || typeof window === 'undefined') return;
        window.localStorage.setItem(FOLLOWED_CREATORS_PANEL_KEY, open ? '1' : '0');
    }, [collapsible, open]);

    const readHandle = () => {
        // Prefer the live DOM value — browser autofill can paint text without firing React onChange.
        const fromDom = normalizeHandle(inputRef.current?.value || '');
        return fromDom || normalizeHandle(draft);
    };

    const addCreator = async () => {
        const handle = readHandle();
        if (!handle) {
            toast('Enter a creator username.', 'error');
            return;
        }
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(handle)) {
            toast('Usernames can only use letters, numbers, dots, underscores, and hyphens.', 'error');
            return;
        }
        if (sorted.some((entry) => entry.toLowerCase() === handle.toLowerCase())) {
            toast('That creator is already in your follow list.', 'error');
            return;
        }
        const next = [...sorted, handle];
        const previous = [...sorted];
        onChange(next);
        setDraft('');
        if (inputRef.current) inputRef.current.value = '';
        setSaving(true);
        try {
            await onSave({ creatorWhitelist: next });
            toast(`Following @${handle}.`);
        } catch (error) {
            onChange(previous);
            toast(error instanceof Error ? error.message : 'Failed to save creators', 'error');
        } finally {
            setSaving(false);
        }
    };

    const removeCreator = async (handle: string) => {
        const next = sorted.filter((entry) => entry.toLowerCase() !== handle.toLowerCase());
        const previous = [...sorted];
        onChange(next);
        setSaving(true);
        try {
            await onSave({ creatorWhitelist: next });
            toast(`Removed @${handle}.`);
        } catch (error) {
            onChange(previous);
            toast(error instanceof Error ? error.message : 'Failed to save creators', 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="space-y-4 rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
            {collapsible ? (
                <button
                    type="button"
                    className="flex w-full min-w-0 items-start justify-between gap-3 text-left"
                    aria-expanded={open}
                    onClick={() => setOpen((value) => !value)}
                >
                    <div className="min-w-0">
                        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            Creators you follow
                            {sorted.length ? (
                                <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-text">
                                    {sorted.length}
                                </span>
                            ) : null}
                        </p>
                        <p className="mt-1 text-sm text-muted">
                            {open
                                ? 'Pin MediUX and ThePosterDB creators for a Browse Following rail. When you search a title, their sets show first.'
                                : 'Tap to add or remove followed creators.'}
                        </p>
                    </div>
                </button>
            ) : (
                <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted">Creators you follow</p>
                    <p className="mt-1 text-sm text-muted">
                        Pin MediUX and ThePosterDB creators for a Browse Following rail. When you search a title, their sets show first.
                    </p>
                </div>
            )}
            {open ? (
                <>
            <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                        ref={inputRef}
                        className={`${fieldClass} pl-9`}
                        value={draft}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        name="poster-sets-follow-creator"
                        onChange={(event) => setDraft(event.target.value)}
                        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void addCreator();
                            }
                        }}
                        placeholder="Username e.g. kaster"
                    />
                </div>
                <button
                    type="button"
                    className={primaryButtonClass}
                    disabled={saveLocked}
                    onClick={() => void addCreator()}
                >
                    {saveLocked ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                </button>
            </div>
            {sorted.length ? (
                <div className="flex flex-wrap gap-2">
                    {sorted.map((handle) => (
                        <div
                            key={handle}
                            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 py-1 pl-2.5 pr-1 text-xs"
                        >
                            <button
                                type="button"
                                className="font-semibold text-plex hover:underline"
                                onClick={() => onOpenCreator?.(handle)}
                            >
                                @{handle}
                            </button>
                            <button
                                type="button"
                                className="rounded-full p-1 text-muted transition hover:bg-white/10 hover:text-red-200"
                                aria-label={`Remove ${handle}`}
                                disabled={saveLocked}
                                onClick={() => void removeCreator(handle)}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-muted">No followed creators yet. Add usernames to populate the Following rail in Browse.</p>
            )}
                </>
            ) : null}
        </section>
    );
}
