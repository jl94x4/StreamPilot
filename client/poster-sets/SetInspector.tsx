import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronUp,
    Expand,
    Loader2,
    X,
} from 'lucide-react';
import type { PosterSetsPreviewAsset, PosterSetsSearchSet } from './types';
import { PosterImageLightbox } from './shared/posterSetsCards';
import { ProviderPill } from './shared/posterSetsPills';
import { PreviewAssetStrip } from './shared/posterSetsPreview';
import {
    assetIdsForQueueKinds,
    groupInspectorThumbs,
    previewAssetsKey,
    previewQueueKindOptions,
    type InspectorThumbPreview,
    type PreviewQueueKind,
} from './previewGroups';
import {
    PREVIEW_THUMB_SCALE_MAX,
    PREVIEW_THUMB_SCALE_MIN,
    previewThumbWidthPx,
} from './previewThumbScale';
import { usePreviewThumbScale } from './usePreviewThumbScale';

const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-plex px-2.5 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';

export type SetInspectorProps = {
    panelRef?: React.RefObject<HTMLDivElement | null>;
    set: PosterSetsSearchSet | null;
    headerLabel: string;
    loading: boolean;
    ready: boolean;
    matchedCount: number;
    unmatchedCount: number;
    totalCount: number;
    selectedCount: number;
    titleCardsOnly?: boolean;
    showAssets: boolean;
    busy: string | null;
    onToggleShowAssets: () => void;
    onQueueMatched: () => void;
    onQueueSelected: () => void;
    onQueueEntire: () => void;
    onQueueUnmatched: () => void;
    onQueueNewSinceWatch: () => void;
    onSelectMatched: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onClose: () => void;
    /** Override the dismiss button label (e.g. "Back to sets" in the library drawer). */
    closeLabel?: string;
    thumbStrip?: React.ReactNode;
    gallery?: React.ReactNode;
    relatedRail?: React.ReactNode;
    /** Preview assets — drives Aura-style Poster / Backdrop / Season / Title card checkboxes. */
    assets?: PosterSetsPreviewAsset[];
    onChangeSelectedIds?: (ids: string[]) => void;
    /** Green “already applied” chip when this set is the title’s last successful apply. */
    alreadyApplied?: boolean;
    alreadyAppliedLabel?: string;
};

export function SetInspector({
    panelRef,
    set,
    headerLabel,
    loading,
    ready,
    matchedCount,
    unmatchedCount,
    totalCount,
    selectedCount,
    titleCardsOnly,
    showAssets,
    busy,
    onToggleShowAssets,
    onQueueMatched,
    onQueueSelected,
    onQueueEntire,
    onQueueUnmatched,
    onQueueNewSinceWatch,
    onSelectMatched,
    onSelectAll,
    onClearSelection,
    onClose,
    closeLabel = 'Close',
    thumbStrip,
    gallery,
    relatedRail,
    assets,
    onChangeSelectedIds,
    alreadyApplied,
    alreadyAppliedLabel,
}: SetInspectorProps) {
    const kindOptions = useMemo(() => previewQueueKindOptions(assets || []), [assets]);
    const assetsKey = previewAssetsKey(assets || []);
    const [selectedKinds, setSelectedKinds] = useState<Set<PreviewQueueKind>>(() => new Set());
    const onChangeSelectedIdsRef = useRef(onChangeSelectedIds);
    onChangeSelectedIdsRef.current = onChangeSelectedIds;

    useEffect(() => {
        const list = assets || [];
        if (!list.length) {
            setSelectedKinds((prev) => (prev.size ? new Set() : prev));
            return;
        }
        const options = previewQueueKindOptions(list);
        const next = new Set(options.map((option) => option.id));
        setSelectedKinds(next);
        onChangeSelectedIdsRef.current?.(assetIdsForQueueKinds(list, next));
        // Fingerprint asset ids so parent selected-id updates don't reset the type picker.
    }, [assetsKey]);

    const toggleKind = (kind: PreviewQueueKind) => {
        const next = new Set(selectedKinds);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        setSelectedKinds(next);
        onChangeSelectedIds?.(assetIdsForQueueKinds(assets || [], next));
    };

    if (!set && !loading && !ready) return null;

    const hasKindPicker = kindOptions.length > 0;
    const queueCount = selectedCount;
    const queueMatchedLabel = hasKindPicker
        ? (queueCount ? `Queue (${queueCount})` : 'Queue')
        : matchedCount
            ? `Queue matched (${matchedCount})`
            : selectedCount
                ? `Queue selected (${selectedCount})`
                : 'Queue matched';

    const dismissIcon = closeLabel.toLowerCase().includes('back')
        ? <ChevronLeft className="h-4 w-4" />
        : <X className="h-4 w-4" />;

    return (
        <div
            ref={panelRef}
            className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
        >
            {loading && !ready ? (
                <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-plex" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text">Loading set…</p>
                        <p className="truncate text-xs text-muted" title={headerLabel || set?.url}>
                            {headerLabel || set?.title || set?.url}
                        </p>
                    </div>
                    <button type="button" className={buttonClass} onClick={onClose} aria-label={closeLabel}>
                        {dismissIcon}
                    </button>
                </div>
            ) : null}

            {ready ? (
                <>
                    <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-bold uppercase tracking-wide text-plex">Selected set</p>
                                    {set ? <ProviderPill provider={set.provider} compact /> : null}
                                </div>
                                <h3 className="mt-1 text-lg font-bold leading-snug text-text sm:truncate" title={headerLabel}>
                                    {headerLabel}
                                </h3>
                                {set?.user ? (
                                    <p className="mt-0.5 truncate text-sm text-muted">
                                        @{String(set.user).trim().replace(/^@+/, '')}
                                    </p>
                                ) : null}
                                {set?.setId ? (
                                    <p className="mt-0.5 text-xs text-muted">Set ID: {set.setId}</p>
                                ) : null}
                            </div>
                            <button type="button" className={`${buttonClass} shrink-0`} onClick={onClose}>
                                {dismissIcon}
                                <span className="hidden sm:inline">{closeLabel}</span>
                            </button>
                        </div>

                        {alreadyApplied ? (
                            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                                Already applied to this title
                                {alreadyAppliedLabel ? ` · ${alreadyAppliedLabel}` : ''}
                            </div>
                        ) : null}

                        <p className="text-sm text-muted">
                            <span className="text-emerald-300">{matchedCount} matched</span>
                            {' · '}
                            <span className="text-amber-200">{unmatchedCount} missing</span>
                            {' · '}
                            {totalCount} in set
                            {hasKindPicker ? null : (
                                <>
                                    {' · '}
                                    {selectedCount} selected
                                </>
                            )}
                        </p>
                    </div>

                    {thumbStrip ? (
                        <div className="min-w-0 border-t border-white/10 pt-4">
                            {thumbStrip}
                        </div>
                    ) : null}

                    {hasKindPicker ? (
                        <div className="space-y-2 border-t border-white/10 pt-4">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Art types</p>
                            <div className="space-y-0.5 rounded-xl border border-white/10 bg-black/25 p-2 sm:p-3">
                                {kindOptions.map((option) => {
                                    const checked = selectedKinds.has(option.id);
                                    return (
                                        <label
                                            key={option.id}
                                            className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5"
                                        >
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 shrink-0 rounded border-white/20 bg-black/40 accent-plex"
                                                checked={checked}
                                                onChange={() => toggleKind(option.id)}
                                            />
                                            <span className="min-w-0 flex-1 text-sm font-medium text-text">{option.label}</span>
                                            <span className="shrink-0 text-xs text-muted">
                                                {option.matched && option.matched !== option.count
                                                    ? `${option.matched}/${option.count}`
                                                    : option.count}
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-muted">
                                {queueCount
                                    ? `${queueCount} image${queueCount === 1 ? '' : 's'} ready to queue`
                                    : 'Check at least one art type to queue.'}
                                {kindOptions.some((option) => option.id === 'title_card')
                                    ? ' Uncheck posters to apply title cards only.'
                                    : ''}
                            </p>
                        </div>
                    ) : (
                        <p className="text-xs text-muted">
                            {titleCardsOnly
                                ? 'Title-card pack — only episode title cards from this set.'
                                : 'Matched art is ready to queue. Click art to enlarge, or open assets to pick pieces.'}
                        </p>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <button
                            type="button"
                            className={`${primaryButtonClass} w-full sm:w-auto sm:min-w-[11rem]`}
                            disabled={busy !== null || (hasKindPicker ? !queueCount : (matchedCount < 1 && !selectedCount))}
                            onClick={onQueueMatched}
                        >
                            {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {queueMatchedLabel}
                        </button>
                        <button
                            type="button"
                            className={`${buttonClass} w-full sm:w-auto`}
                            disabled={busy !== null}
                            onClick={onQueueEntire}
                        >
                            Queue entire set
                        </button>
                        <button type="button" className={`${buttonClass} w-full sm:w-auto`} onClick={onToggleShowAssets}>
                            {showAssets ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {showAssets ? 'Hide assets' : 'Show all assets'}
                        </button>
                    </div>

                    {showAssets ? (
                        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                            <button type="button" className={buttonClass} onClick={onSelectMatched}>Matched only</button>
                            <button type="button" className={buttonClass} onClick={onSelectAll}>Select all</button>
                            <button type="button" className={buttonClass} onClick={onClearSelection}>Clear selection</button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null || !selectedCount}
                                onClick={onQueueSelected}
                            >
                                Queue selected ({selectedCount})
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                onClick={onQueueUnmatched}
                            >
                                Queue unmatched
                            </button>
                            <button
                                type="button"
                                className={buttonClass}
                                disabled={busy !== null}
                                onClick={onQueueNewSinceWatch}
                            >
                                Queue new since watch
                            </button>
                        </div>
                    ) : null}

                    {showAssets && gallery ? (
                        <div className="space-y-3 border-t border-white/10 pt-3">
                            {gallery}
                        </div>
                    ) : null}

                    {relatedRail}
                </>
            ) : null}
        </div>
    );
}

/** Featured matched-art preview — posters, backdrops, and title cards never share a row. */
export function SetInspectorThumbStrip({
    thumbs,
    layout = 'poster',
    setUrl,
    provider,
}: {
    thumbs: Array<InspectorThumbPreview>;
    layout?: 'poster' | 'landscape';
    setUrl?: string | null;
    provider?: string | null;
}) {
    const [lightbox, setLightbox] = useState<InspectorThumbPreview | null>(null);
    const groups = useMemo(() => groupInspectorThumbs(thumbs, layout), [thumbs, layout]);
    const [thumbScale, setThumbScale] = usePreviewThumbScale();
    if (!groups.length) return null;

    const showGroupLabels = groups.length > 1;
    const sizeSlider = (
        <label className="flex min-w-0 items-center gap-2 text-[11px] font-semibold normal-case tracking-normal text-muted">
            Size
            <input
                type="range"
                min={PREVIEW_THUMB_SCALE_MIN}
                max={PREVIEW_THUMB_SCALE_MAX}
                step={5}
                value={thumbScale}
                aria-label="Preview image size"
                className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-white/15 accent-plex sm:w-36 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-plex [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-plex"
                onChange={(event) => setThumbScale(Number(event.target.value))}
            />
        </label>
    );

    return (
        <div className="space-y-2">
            <PosterImageLightbox
                open={Boolean(lightbox)}
                src={lightbox?.thumbUrl || ''}
                title={lightbox?.title}
                setUrl={setUrl}
                provider={provider}
                onClose={() => setLightbox(null)}
            />
            <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-2.5 sm:p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
                        Preview
                        <span className="inline-flex items-center gap-1 font-semibold normal-case tracking-normal text-muted/70">
                            <Expand className="h-3 w-3" />
                            Click to enlarge
                        </span>
                    </div>
                    {sizeSlider}
                </div>
                {groups.map((group) => {
                    const landscape = group.layout === 'landscape';
                    const thumbWidth = previewThumbWidthPx(group.layout, thumbScale);
                    return (
                        <PreviewAssetStrip
                            key={group.id}
                            count={group.thumbs.length}
                            shiftDrag
                            hint={landscape ? 'Shift-drag to scroll' : undefined}
                            title={showGroupLabels ? group.label : null}
                        >
                            {group.thumbs.map((thumb) => {
                                const canPreview = Boolean(String(thumb.thumbUrl || '').trim());
                                return (
                                    <button
                                        key={thumb.id}
                                        type="button"
                                        disabled={!canPreview}
                                        className={`group relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/40 text-left shadow-sm transition ${
                                            landscape ? 'aspect-[16/9]' : 'aspect-[2/3]'
                                        } ${
                                            canPreview
                                                ? 'cursor-zoom-in hover:border-plex/50 hover:ring-1 hover:ring-plex/30'
                                                : 'cursor-default opacity-60'
                                        }`}
                                        style={{ width: `${thumbWidth}px` }}
                                        title={canPreview ? `Enlarge ${thumb.title}` : thumb.title}
                                        aria-label={canPreview ? `Enlarge ${thumb.title}` : thumb.title}
                                        onClick={() => {
                                            if (!canPreview) return;
                                            setLightbox(thumb);
                                        }}
                                    >
                                        {thumb.thumbUrl ? (
                                            <img
                                                src={thumb.thumbUrl}
                                                alt={thumb.title}
                                                className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.02]"
                                                loading="lazy"
                                                draggable={false}
                                            />
                                        ) : (
                                            <div className="h-full w-full bg-white/5" />
                                        )}
                                        {canPreview ? (
                                            <span className="pointer-events-none absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/15 bg-black/65 text-text opacity-0 transition group-hover:opacity-100">
                                                <Expand className="h-3 w-3" />
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </PreviewAssetStrip>
                    );
                })}
            </div>
        </div>
    );
}
