import { MoreHorizontal } from 'lucide-react';
import React,{ useEffect,useRef,useState } from 'react';

import { useDiscoverI18n } from '../discovery/i18n';
import { portalUrl,resolvePortalAssetUrl } from '../shared/basePath';
import { NoPosterPlaceholder } from '../shared/NoPosterPlaceholder';
import { RetryablePoster } from '../shared/RetryablePoster';
import { TvButton } from '../shared/TvButton';




export const DiscoverPosterCard: React.FC<{
    item: { title: string; thumb?: string; thumbUrl?: string; posterFallbackUrl?: string; plexUrl: string; tags?: string[]; year?: number | string; parentTitle?: string; ratingKey?: string; mediaType?: string; type?: string };
    aspect?: '2/3' | 'square' | '16/9';
    overlay?: React.ReactNode;
    variant?: 'discover' | 'home';
    className?: string;
    footer?: React.ReactNode;
    showQualityBadges?: boolean;
    posterOnlyLink?: boolean;
    onPosterClick?: () => void;
    onPosterHover?: () => void;
    quickActions?: Array<{
        id: string;
        label: string;
        tone?: 'default' | 'danger';
        onClick: () => void | Promise<void>;
    }>;
    posterWidth?: number;
    posterHeight?: number;
    posterQuality?: number;
    /** Skip the hover scale. That transform resamples the bitmap and softens hero art. */
    disableImageScale?: boolean;
    frameClassName?: string;
    loading?: 'lazy' | 'eager';
    fetchPriority?: 'high' | 'low' | 'auto';
}> = ({ item, aspect, overlay, variant = 'discover', className = 'w-full', footer, showQualityBadges = true, posterOnlyLink = false, onPosterClick, onPosterHover, quickActions, posterWidth = 300, posterHeight, posterQuality, disableImageScale = false, frameClassName = '', loading, fetchPriority }) => {
    const { t } = useDiscoverI18n();
    const resolvedAspect = aspect ?? (
        item?.mediaType === 'music' || item?.type === 'music' ? 'square' : '2/3'
    );
    const resolvedPosterHeight = posterHeight ?? (
        resolvedAspect === 'square'
            ? posterWidth
            : resolvedAspect === '16/9'
                ? Math.round(posterWidth * 9 / 16)
                : Math.round(posterWidth * 1.5)
    );
    const posterShell = `${variant === 'home'
        ? 'player-poster-frame relative rounded-[12px] overflow-hidden bg-background border border-border transition-[border-color] duration-300 group-hover:border-plex/50'
        : 'player-poster-frame relative rounded-[12px] overflow-hidden border border-border group-hover:border-plex transition-colors bg-card'}${frameClassName ? ` ${frameClassName}` : ''}`;

    const remoteThumb = typeof item.thumb === 'string' && /^https?:\/\//i.test(item.thumb);
    const readyThumb = String(item.thumbUrl || item.thumb || '');
    const primaryPosterSrc = /^(blob|data):/i.test(readyThumb)
        ? readyThumb
        : item.thumbUrl
        ? resolvePortalAssetUrl(item.thumbUrl)
        : remoteThumb
            ? resolvePortalAssetUrl(item.thumb)
            : item.thumb
                ? portalUrl(`/api/plex/image?path=${encodeURIComponent(item.thumb)}&width=${posterWidth}&height=${resolvedPosterHeight}${posterQuality ? `&quality=${posterQuality}` : ''}`)
                : '';
    const fallbackPosterSrc = item.posterFallbackUrl
        ? resolvePortalAssetUrl(item.posterFallbackUrl)
        : '';
    const [quickActionsOpen, setQuickActionsOpen] = useState(false);
    const quickActionsRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!quickActionsOpen) return;
        const onDocMouseDown = (event: MouseEvent) => {
            if (!quickActionsRef.current) return;
            if (!quickActionsRef.current.contains(event.target as Node)) {
                setQuickActionsOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setQuickActionsOpen(false);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [quickActionsOpen]);

    const hasPoster = !!(primaryPosterSrc || fallbackPosterSrc);
    const hasQuickActions = Array.isArray(quickActions) && quickActions.length > 0;
    const posterInner = (
        <div
            data-tv-poster="1"
            className={`${posterShell} ${resolvedAspect === 'square' ? 'aspect-square' : resolvedAspect === '16/9' ? 'aspect-video' : 'aspect-[2/3]'} w-full`}
        >
            {!hasPoster ? (
                <NoPosterPlaceholder />
            ) : (
                <RetryablePoster
                    src={primaryPosterSrc}
                    fallbackSrc={fallbackPosterSrc}
                    alt={item.title}
                    loading={loading ?? (variant === 'home' ? 'eager' : 'lazy')}
                    fetchPriority={fetchPriority}
                    compactPlaceholder={false}
                    className={`absolute inset-0 h-full w-full object-cover ${variant === 'home' && !disableImageScale ? 'transition-[transform,opacity] duration-300 group-hover:scale-105 group-hover:opacity-80' : ''}`}
                />
            )}
            {hasQuickActions && (
                <div
                    ref={quickActionsRef}
                    className="absolute inset-0 z-10 pointer-events-none"
                >
                    <div className="absolute top-1 left-1 sm:top-1.5 sm:left-1.5 pointer-events-auto">
                        <button
                            type="button"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuickActionsOpen((open) => !open);
                            }}
                            className="inline-flex items-center justify-center p-0.5 leading-none rounded-md bg-black/65 text-white/90 border border-white/20 hover:bg-black/80 hover:text-white transition-colors"
                            aria-label={t('quickActions.menuLabel')}
                            aria-expanded={quickActionsOpen}
                        >
                            <MoreHorizontal className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        </button>
                    </div>
                    {quickActionsOpen && (
                        <div
                            className="absolute inset-0 bg-black/80 px-2 py-2 flex flex-col justify-end gap-1 pointer-events-auto"
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuickActionsOpen(false);
                            }}
                        >
                            {quickActions!.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setQuickActionsOpen(false);
                                        void action.onClick();
                                    }}
                                    className={`w-full text-left px-2.5 py-2 rounded-md text-[11px] font-semibold transition-colors ${
                                        action.tone === 'danger'
                                            ? 'text-rose-200 bg-rose-500/20 hover:bg-rose-500/30'
                                            : 'text-white bg-white/10 hover:bg-white/20'
                                    }`}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {overlay}
            {showQualityBadges && item.tags && item.tags.length > 0 && (
                <div className={`absolute left-1 right-1 flex flex-wrap gap-0.5 pointer-events-none z-20 ${overlay ? 'bottom-7' : 'bottom-1'}`}>
                    {item.tags.map((tag) => (
                        <span key={tag} className="text-[8px] font-bold px-1 py-px rounded bg-black/85 text-white/95 border border-white/15 uppercase tracking-wide">
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );

    const defaultFooter = (
        <div className={`player-poster-caption ${posterOnlyLink ? 'text-base font-semibold' : 'text-xs font-medium'} line-clamp-2 leading-snug text-text ${variant === 'home' ? 'text-left px-1' : 'text-center mt-1'}`}>
            {item.title}
        </div>
    );

    if (posterOnlyLink) {
        const posterWrapper = onPosterClick ? (
            <TvButton
                type="button"
                onClick={onPosterClick}
                onMouseEnter={onPosterHover}
                onFocus={() => {
                    onPosterHover?.();
                }}
                data-tv-item="1"
                data-tv-poster-btn="1"
                data-tv-key={item.ratingKey || undefined}
                className="block w-full text-left border-0 p-0 bg-transparent cursor-pointer outline-none focus:outline-none"
                style={{ color: 'inherit' }}
            >
                {posterInner}
            </TvButton>
        ) : (
            <a
                href={item.plexUrl}
                target="_blank"
                rel="noreferrer"
                onMouseEnter={onPosterHover}
                onFocus={onPosterHover}
                className="block no-underline"
                style={{ textDecoration: 'none', color: 'inherit' }}
            >
                {posterInner}
            </a>
        );

        return (
            <div
                data-tv-poster-card="1"
                className={`flex flex-col gap-2 group outline-none ${className}`}
                style={{ color: 'inherit' }}
            >
                {posterWrapper}
                {footer ?? defaultFooter}
            </div>
        );
    }

    if (onPosterClick && !posterOnlyLink) {
        if (hasQuickActions) {
            return (
                <div
                    role="button"
                    tabIndex={0}
                    data-tv-item="1"
                    onMouseEnter={onPosterHover}
                    onFocus={onPosterHover}
                    onClick={() => onPosterClick()}
                    onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onPosterClick();
                        }
                    }}
                    className={`flex flex-col gap-2 group text-left cursor-pointer ${className}`}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                >
                    {posterInner}
                    {footer ?? defaultFooter}
                </div>
            );
        }
        return (
            <button
                type="button"
                onClick={onPosterClick}
                onMouseEnter={onPosterHover}
                onFocus={onPosterHover}
                data-tv-item="1"
                className={`flex flex-col gap-2 group text-left border-0 p-0 bg-transparent cursor-pointer ${className}`}
                style={{ color: 'inherit', textDecoration: 'none' }}
            >
                {posterInner}
                {footer ?? defaultFooter}
            </button>
        );
    }

    return (
        <a href={item.plexUrl} target="_blank" rel="noreferrer" onMouseEnter={onPosterHover} onFocus={onPosterHover} className={`flex flex-col gap-2 group no-underline ${className}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            {posterInner}
            {footer ?? defaultFooter}
        </a>
    );
};

export const discoverViewsOverlay = (views: number) => (
    <div className="absolute inset-x-0 bottom-0 z-10 pointer-events-none bg-gradient-to-t from-black/85 via-black/45 to-transparent pt-6 pb-1.5 px-1.5">
        <span className="text-[10px] font-semibold text-white/90 tracking-wide">
            {views} {views === 1 ? 'view' : 'views'}
        </span>
    </div>
);
