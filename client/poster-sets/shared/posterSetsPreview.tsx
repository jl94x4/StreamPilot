import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { posterSetsApi } from '../api';
import { previewAssetEpisodeLabel, type PreviewAssetSections } from '../previewGroups';
import { type PosterSetsPreviewAsset } from '../types';
import { previewThumbWidthPx } from '../previewThumbScale';
import { usePreviewThumbScale } from '../usePreviewThumbScale';
import { posterMediaRadiusClass, previewStripClass } from './posterSetsUi';

export function PreviewAssetTile({
    asset,
    selected,
    layout,
    caption,
    onToggle,
}: {
    asset: PosterSetsPreviewAsset;
    selected: boolean;
    layout: 'poster' | 'landscape';
    caption?: string;
    onToggle: (id: string) => void;
}) {
    const [thumbScale] = usePreviewThumbScale();
    const matched = asset.matched === true;
    const unmatched = asset.matched === false;
    const title = caption
        || (layout === 'landscape' ? previewAssetEpisodeLabel(asset) : `${asset.title}${asset.year ? ` (${asset.year})` : ''}`);
    return (
        <button
            type="button"
            onClick={() => onToggle(asset.id)}
            className={`group shrink-0 overflow-hidden ${posterMediaRadiusClass} border text-left transition ${
                selected
                    ? 'border-plex/60 bg-plex/10 ring-1 ring-plex/40'
                    : unmatched
                        ? 'border-amber-500/45 bg-amber-500/[0.06] hover:border-amber-400/60'
                        : 'border-white/10 bg-black/20 hover:border-plex/35'
            }`}
            style={{ width: `${previewThumbWidthPx(layout, thumbScale)}px` }}
        >
            <div className={`relative bg-black/40 ${layout === 'landscape' ? 'aspect-[16/9]' : 'aspect-[2/3]'}`}>
                {asset.thumbUrl ? (
                    <img
                        src={posterSetsApi.imageUrl(asset.thumbUrl)}
                        alt={asset.title}
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                        <ImageIcon className="h-8 w-8 opacity-40" />
                    </div>
                )}
                <span className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    matched
                        ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-100'
                        : unmatched
                            ? 'border-amber-500/40 bg-amber-500/20 text-amber-100'
                            : 'border-white/15 bg-black/50 text-muted'
                }`}>
                    {matched ? 'In library' : unmatched ? 'Missing' : 'Unknown'}
                </span>
                <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold ${
                    selected
                        ? 'border-plex bg-plex text-background'
                        : 'border-white/20 bg-black/50 text-muted'
                }`}>
                    {selected ? '✓' : ''}
                </span>
            </div>
            <div className="space-y-0.5 p-2.5 sm:p-3">
                <p className="truncate text-xs font-semibold text-text sm:text-sm" title={title}>
                    {title}
                </p>
                {layout === 'poster' ? (
                    <p className="truncate text-[10px] font-bold uppercase tracking-wide text-plex/90 sm:text-[11px]">{asset.label}</p>
                ) : null}
                {asset.matchDetail ? (
                    <p className="truncate text-[10px] text-muted sm:text-[11px]" title={asset.matchDetail}>{asset.matchDetail}</p>
                ) : null}
            </div>
        </button>
    );
}

export function PreviewAssetStrip({
    title,
    count,
    children,
    hint,
    shiftDrag = false,
}: {
    title?: React.ReactNode;
    count: number;
    children: React.ReactNode;
    hint?: React.ReactNode;
    shiftDrag?: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; moved: boolean } | null>(null);
    const ignoreClickRef = useRef(false);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(true);
    const [dragging, setDragging] = useState(false);

    const updateScrollState = useCallback(() => {
        const node = scrollRef.current;
        if (!node) return;
        const { scrollLeft, scrollWidth, clientWidth } = node;
        const margin = 8;
        const canScroll = scrollWidth > clientWidth + margin;
        if (!canScroll) {
            setAtStart(true);
            setAtEnd(true);
            return;
        }
        setAtStart(scrollLeft <= margin);
        setAtEnd(scrollLeft >= scrollWidth - clientWidth - margin);
    }, []);

    useEffect(() => {
        updateScrollState();
        const node = scrollRef.current;
        if (!node) return undefined;
        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => updateScrollState())
            : null;
        resizeObserver?.observe(node);
        const timer = window.setTimeout(updateScrollState, 120);
        window.addEventListener('resize', updateScrollState);
        return () => {
            resizeObserver?.disconnect();
            window.clearTimeout(timer);
            window.removeEventListener('resize', updateScrollState);
        };
    }, [children, updateScrollState]);

    const scrollByPage = (direction: 'left' | 'right') => {
        const node = scrollRef.current;
        if (!node) return;
        const amount = Math.max(240, Math.floor(node.clientWidth * 0.85));
        node.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
    };

    const endShiftDrag = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        setDragging(false);
        if (drag.moved) ignoreClickRef.current = true;
        try {
            scrollRef.current?.releasePointerCapture(event.pointerId);
        } catch {
            /* already released */
        }
    };

    const showArrows = !(atStart && atEnd);

    return (
        <section className="min-w-0 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                    {title ? <h4 className="min-w-0 text-xs font-bold uppercase tracking-wide text-muted">{title}</h4> : null}
                    <span className="shrink-0 text-[11px] text-muted/80">{count}</span>
                    {hint && showArrows ? (
                        <span className="hidden text-[11px] font-medium normal-case tracking-normal text-muted/70 sm:inline">
                            {hint}
                        </span>
                    ) : null}
                </div>
                {showArrows ? (
                    <div className="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            onClick={() => scrollByPage('left')}
                            disabled={atStart}
                            className={`inline-flex min-h-9 min-w-9 touch-manipulation items-center justify-center rounded-lg border border-white/10 transition ${
                                atStart ? 'cursor-default text-muted/30' : 'text-muted hover:border-plex/40 hover:bg-white/5 hover:text-text active:scale-95'
                            }`}
                            aria-label="Scroll left"
                        >
                            <ChevronLeft className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollByPage('right')}
                            disabled={atEnd}
                            className={`inline-flex min-h-9 min-w-9 touch-manipulation items-center justify-center rounded-lg border border-white/10 transition ${
                                atEnd ? 'cursor-default text-muted/30' : 'text-muted hover:border-plex/40 hover:bg-white/5 hover:text-text active:scale-95'
                            }`}
                            aria-label="Scroll right"
                        >
                            <ChevronRight className="h-5 w-5" />
                        </button>
                    </div>
                ) : null}
            </div>
            <div
                ref={scrollRef}
                onScroll={updateScrollState}
                onPointerDownCapture={(event) => {
                    if (!shiftDrag || !event.shiftKey || event.button !== 0 || (atStart && atEnd)) return;
                    const node = scrollRef.current;
                    if (!node) return;
                    event.preventDefault();
                    dragRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startScroll: node.scrollLeft,
                        moved: false,
                    };
                    setDragging(true);
                    ignoreClickRef.current = false;
                    node.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const drag = dragRef.current;
                    const node = scrollRef.current;
                    if (!drag || drag.pointerId !== event.pointerId || !node) return;
                    const dx = event.clientX - drag.startX;
                    if (Math.abs(dx) > 3) drag.moved = true;
                    node.scrollLeft = drag.startScroll - dx;
                    event.preventDefault();
                }}
                onPointerUp={endShiftDrag}
                onPointerCancel={endShiftDrag}
                onClickCapture={(event) => {
                    if (!ignoreClickRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    ignoreClickRef.current = false;
                }}
                className={`${previewStripClass} ${dragging ? 'cursor-grabbing select-none scroll-auto' : ''}`}
                title={shiftDrag && showArrows ? 'Hold Shift and drag to scroll' : undefined}
            >
                {children}
            </div>
        </section>
    );
}

export function PreviewAssetGallery({
    sections,
    selectedAssetIds,
    onToggle,
}: {
    sections: PreviewAssetSections;
    selectedAssetIds: string[];
    onToggle: (id: string) => void;
}) {
    const renderStrip = (
        title: string,
        assets: PosterSetsPreviewAsset[],
        layout: 'poster' | 'landscape',
        captionFor?: (asset: PosterSetsPreviewAsset) => string | undefined,
    ) => {
        if (!assets.length) return null;
        return (
            <PreviewAssetStrip title={title} count={assets.length} shiftDrag={layout === 'landscape'} hint={layout === 'landscape' ? 'Shift-drag to scroll' : undefined}>
                {assets.map((asset) => (
                    <PreviewAssetTile
                        key={asset.id}
                        asset={asset}
                        selected={selectedAssetIds.includes(asset.id)}
                        layout={layout}
                        caption={captionFor?.(asset)}
                        onToggle={onToggle}
                    />
                ))}
            </PreviewAssetStrip>
        );
    };

    return (
        <div className="min-w-0 space-y-5">
            {renderStrip('Show & season covers', sections.covers, 'poster', (asset) => asset.label || asset.title)}
            {renderStrip('Posters', sections.posters, 'poster')}
            {renderStrip('Backgrounds', sections.backgrounds, 'landscape', (asset) => asset.label || 'Background')}
            {sections.titleCardSeasons.map((season) => (
                <PreviewAssetStrip
                    key={season.key}
                    count={season.assets.length}
                    shiftDrag
                    hint="Shift-drag to scroll"
                    title={(
                        <>
                            {season.label}
                            <span className="ml-2 font-semibold normal-case tracking-normal text-muted/70">title cards</span>
                        </>
                    )}
                >
                    {season.assets.map((asset) => (
                        <PreviewAssetTile
                            key={asset.id}
                            asset={asset}
                            selected={selectedAssetIds.includes(asset.id)}
                            layout="landscape"
                            caption={previewAssetEpisodeLabel(asset)}
                            onToggle={onToggle}
                        />
                    ))}
                </PreviewAssetStrip>
            ))}
            {renderStrip('Other assets', sections.other, 'poster')}
        </div>
    );
}
