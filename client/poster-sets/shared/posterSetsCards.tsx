import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { ModalPortal } from '../../shared/ModalPortal';
import { posterSetsApi } from '../api';
import { libraryItemPosterSrc, type LibraryRecentItem } from '../libraryRecent';
import { type PosterSetsSearchSet } from '../types';
import { posterMediaRadiusClass, previewStripClass } from './posterSetsUi';
import { isTitleCardSet } from './posterSetsRecent';
import { CreatorPill, ProviderCornerBadge, ProviderPill, SetKindPill } from './posterSetsPills';
import { providerLabel } from './posterSetsFormat';
import { coverageBadgeClass, coverageBadgeLabel, type TpdbCoverageLevel } from './tpdbCacheUi';
import { safeHttpUrl, safeImageSrc } from '../../shared/safeUrl';

/** Proxied poster thumb with retry + graceful fallback when TPDB rate-limits. */
export const PosterThumb: React.FC<{
    src?: string | null;
    alt?: string;
    className?: string;
    imgClassName?: string;
    loading?: 'lazy' | 'eager';
    onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
}> = ({ src, alt = '', className = '', imgClassName = '', loading = 'lazy', onLoad }) => {
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const resolved = safeImageSrc(src);
    useEffect(() => {
        setFailed(false);
        setAttempt(0);
    }, [resolved]);
    if (!resolved || failed) {
        return (
            <div className={`flex items-center justify-center bg-black text-muted ${className}`}>
                <ImageIcon className="h-8 w-8 opacity-40 sm:h-10 sm:w-10" />
            </div>
        );
    }
    return (
        <div className={`overflow-hidden bg-black ${className}`}>
            <img
                key={`${resolved}::${attempt}`}
                src={resolved}
                alt={alt}
                loading={loading}
                decoding="async"
                className={imgClassName || 'h-full w-full object-contain object-center'}
                onLoad={onLoad}
                onError={() => {
                    if (attempt < 2) {
                        window.setTimeout(() => setAttempt((value) => value + 1), 900 + attempt * 700);
                        return;
                    }
                    setFailed(true);
                }}
            />
        </div>
    );
};

/** Full-screen poster/title-card preview with optional link to the source set. */
export const PosterImageLightbox: React.FC<{
    open: boolean;
    src: string;
    title?: string | null;
    setUrl?: string | null;
    provider?: string | null;
    onClose: () => void;
}> = ({ open, src, title, setUrl, provider, onClose }) => {
    const resolved = safeImageSrc(src);
    const link = safeHttpUrl(setUrl);
    const label = providerLabel(provider) || 'source site';

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    return (
        <ModalPortal open={open && Boolean(resolved)}>
            <div
                className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-label={title ? `Preview ${title}` : 'Poster preview'}
                onClick={onClose}
            >
                <button
                    type="button"
                    className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-text transition hover:border-white/30 hover:bg-black/80 sm:right-5 sm:top-5"
                    aria-label="Close preview"
                    onClick={onClose}
                >
                    <X className="h-5 w-5" />
                </button>
                <div
                    className="flex max-h-full w-full max-w-5xl flex-col gap-3"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40">
                        <img
                            src={resolved}
                            alt={title || 'Poster preview'}
                            className="max-h-[min(82vh,900px)] max-w-full object-contain"
                        />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                        <p className="min-w-0 truncate text-sm font-semibold text-text" title={title || undefined}>
                            {title || 'Poster preview'}
                        </p>
                        {link ? (
                            <a
                                href={link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-plex/40 bg-plex/15 px-3 py-1.5 text-xs font-semibold text-plex no-underline transition hover:bg-plex/25"
                            >
                                Open on {label}
                                <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                        ) : null}
                    </div>
                </div>
            </div>
        </ModalPortal>
    );
};

export type BulkSetSelection = {
    url: string;
    title?: string | null;
    user?: string | null;
    thumbUrl?: string;
    provider?: string | null;
    setId?: string | null;
    setKind?: string | null;
};

export const bulkEntryFromSet = (set: PosterSetsSearchSet): BulkSetSelection => ({
    url: set.url,
    title: set.title,
    user: set.user,
    thumbUrl: set.thumbUrl,
    provider: set.provider,
    setId: set.setId,
    setKind: set.setKind || (isTitleCardSet(set) ? 'title_cards' : null),
});

/** Copy a library title for pasting into ThePosterDB. Overlay this on the poster. */
export function CopyTitleButton({
    title,
    className = '',
}: {
    title: string;
    className?: string;
}) {
    const [copied, setCopied] = useState(false);
    const text = String(title || '').trim();
    if (!text) return null;

    return (
        <button
            type="button"
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/20 bg-black/70 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90 hover:text-plex ${className}`}
            aria-label={copied ? 'Copied title' : `Copy title ${text}`}
            title={copied ? 'Copied' : 'Copy title'}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void navigator.clipboard.writeText(text).then(
                    () => {
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1500);
                    },
                    () => undefined,
                );
            }}
        >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
    );
}

export function BrowseSetCard({
    set,
    onOpen,
    onOpenCreator,
    disabled,
    bulkSelected = false,
    expanded = false,
    onToggleBulk,
}: {
    set: PosterSetsSearchSet;
    onOpen: (set: PosterSetsSearchSet) => void;
    onOpenCreator?: (user: string) => void;
    disabled?: boolean;
    bulkSelected?: boolean;
    expanded?: boolean;
    onToggleBulk?: () => void;
}) {
    const setTitle = String(set.title || '').trim() || `Set #${set.setId}`;
    const landscape = isTitleCardSet(set);
    return (
        <div className={`group relative flex w-full min-w-0 flex-col overflow-hidden ${posterMediaRadiusClass} border bg-black/20 text-center transition hover:border-plex/40 ${
            expanded
                ? 'border-plex/60 ring-1 ring-plex/30'
                : bulkSelected
                    ? 'border-plex/40 ring-1 ring-plex/20'
                    : 'border-white/10'
        }`}>
            {onToggleBulk ? (
                <label
                    className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-white/20 bg-black/60"
                    onClick={(event) => event.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[var(--plex,#e5a00d)]"
                        checked={bulkSelected}
                        onChange={onToggleBulk}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${setTitle}`}
                    />
                </label>
            ) : null}
            <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(set)}
                className="flex w-full min-w-0 flex-col text-center disabled:opacity-50"
            >
                <div className={`relative w-full shrink-0 overflow-hidden bg-black ${landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'}`}>
                    <PosterThumb
                        src={set.thumbUrl ? posterSetsApi.imageUrl(set.thumbUrl) : ''}
                        alt={setTitle}
                        className="absolute inset-0 h-full w-full"
                        imgClassName="absolute inset-0 h-full w-full object-contain object-center"
                    />
                    <ProviderCornerBadge provider={set.provider} />
                </div>
                <div className="min-w-0 px-1.5 pt-1.5 sm:px-2 sm:pt-1.5">
                    <p className="line-clamp-2 text-center text-[10px] font-medium leading-snug text-text/90 sm:text-[11px]" title={setTitle}>{setTitle}</p>
                </div>
            </button>
            <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1.5 pt-1 sm:px-2 sm:pb-2">
                <CreatorPill user={set.user} onOpen={onOpenCreator} compact />
                <SetKindPill set={set} compact />
                <ProviderPill provider={set.provider} compact />
            </div>
        </div>
    );
}

export function LibraryMediaCard({
    item,
    disabled,
    onOpen,
    cacheLevel = null,
    showCopyTitle = false,
    watching = false,
}: {
    item: LibraryRecentItem;
    disabled?: boolean;
    onOpen: (item: LibraryRecentItem) => void;
    cacheLevel?: TpdbCoverageLevel | string | null;
    showCopyTitle?: boolean;
    watching?: boolean;
}) {
    const label = item.year ? `${item.title} (${item.year})` : item.title;
    const cacheLabel = coverageBadgeLabel(cacheLevel);
    return (
        <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-black/20 text-left transition hover:border-plex/40">
            <div className="group/poster relative aspect-[2/3] w-full shrink-0 overflow-hidden bg-black text-center">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onOpen(item)}
                    className="absolute inset-0 disabled:opacity-50"
                    aria-label={label}
                >
                    <PosterThumb
                        src={libraryItemPosterSrc(item)}
                        alt={item.title}
                        className="absolute inset-0 h-full w-full"
                        imgClassName="absolute inset-0 h-full w-full object-cover"
                    />
                    <span className="absolute bottom-2 left-2 rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                        {item.mediaType === 'movie' ? 'Movie' : 'TV'}
                    </span>
                    {watching ? (
                        <span
                            className="absolute bottom-2 right-2 rounded-full border border-plex/35 bg-plex/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-plex"
                            title="Already watching a poster set for this title"
                        >
                            Watching
                        </span>
                    ) : null}
                    {cacheLabel ? (
                        <span
                            className={`absolute right-1.5 top-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${coverageBadgeClass(cacheLevel)}`}
                            title={
                                cacheLevel === 'images'
                                    ? 'Title, set pages, and images cached'
                                    : cacheLevel === 'sets'
                                        ? 'Title + set pages cached'
                                        : 'Title set list cached'
                            }
                        >
                            {cacheLabel}
                        </span>
                    ) : null}
                </button>
                {showCopyTitle ? (
                    <CopyTitleButton
                        title={item.title}
                        className="absolute left-1.5 top-1.5 z-10 opacity-0 pointer-events-none transition-opacity group-hover/poster:pointer-events-auto group-hover/poster:opacity-100 group-focus-within/poster:pointer-events-auto group-focus-within/poster:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                    />
                ) : null}
            </div>
            <button
                type="button"
                disabled={disabled}
                onClick={() => onOpen(item)}
                className="min-w-0 px-2 py-2 text-left disabled:opacity-50"
            >
                <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-text sm:text-xs" title={label}>
                    {item.title}
                </p>
                {item.year ? (
                    <p className="mt-0.5 text-[10px] text-muted">{item.year}</p>
                ) : null}
            </button>
        </div>
    );
}

export function RelatedSetsRail({
    sets,
    loading,
    mediaLabel,
    disabled,
    onOpen,
    onOpenCreator,
}: {
    sets: PosterSetsSearchSet[];
    loading: boolean;
    mediaLabel: string;
    disabled?: boolean;
    onOpen: (set: PosterSetsSearchSet) => void;
    onOpenCreator?: (user: string) => void;
}) {
    if (!loading && !sets.length) return null;
    return (
        <div className="space-y-2.5 border-t border-white/10 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted">
                    Other sets for this {mediaLabel}
                </h3>
                {loading ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Finding sets…
                    </span>
                ) : (
                    <span className="text-[11px] text-muted">{sets.length} available</span>
                )}
            </div>
            {sets.length ? (
                <div className={previewStripClass}>
                    {sets.map((set) => (
                        <div
                            key={`${set.provider || 'set'}-${set.setId}`}
                            className="w-[7.5rem] shrink-0 sm:w-36"
                        >
                            <BrowseSetCard
                                set={set}
                                disabled={disabled}
                                onOpen={onOpen}
                                onOpenCreator={onOpenCreator}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-xs text-muted">Looking for more packs on MediUX and ThePosterDB…</p>
            )}
        </div>
    );
}
