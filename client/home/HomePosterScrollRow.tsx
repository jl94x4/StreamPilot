import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DiscoverTranslate } from '../discovery/i18n/types';

type Props = {
    title: string;
    children: React.ReactNode;
    t: DiscoverTranslate;
    emptyMessage?: string;
    viewAllLabel?: string;
    onViewAll?: () => void;
};

export const HomePosterScrollRow: React.FC<Props> = ({
    title,
    children,
    t,
    emptyMessage,
    viewAllLabel,
    onViewAll,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const childItems = React.Children.toArray(children);
    const isEmpty = childItems.length === 0;

    const updateScrollState = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        setCanScrollLeft(el.scrollLeft > 4);
        setCanScrollRight(el.scrollLeft < maxScroll - 4);
    }, []);

    useEffect(() => {
        updateScrollState();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', updateScrollState, { passive: true });
        const ro = new ResizeObserver(updateScrollState);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateScrollState);
            ro.disconnect();
        };
    }, [updateScrollState, children]);

    const scroll = (direction: -1 | 1) => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
    };

    return (
        <div className="glass-card p-4 md:p-5 shadow-xl overflow-hidden w-full">
            <div className="flex items-start justify-between gap-3 mb-3">
                <h3 className="text-lg md:text-xl font-bold text-text min-w-0">{title}</h3>
                {onViewAll ? (
                    <button
                        type="button"
                        onClick={onViewAll}
                        className="shrink-0 text-xs font-bold text-plex hover:underline mt-1"
                    >
                        {viewAllLabel || t('common.viewAll')}
                    </button>
                ) : null}
            </div>
            {isEmpty ? (
                <p className="text-sm text-muted py-4">{emptyMessage || t('homeDashboard.emptyRecentMovies')}</p>
            ) : (
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => scroll(-1)}
                        disabled={!canScrollLeft}
                        aria-label={t('homeDashboard.scrollRowLeft', { title })}
                        className="hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full bg-black/70 border border-white/10 text-text hover:bg-black/90 hover:border-plex/50 disabled:opacity-0 disabled:pointer-events-none transition-all shadow-lg -ml-1"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div
                        ref={scrollRef}
                        className="flex overflow-x-auto gap-4 pb-4 snap-x hide-scrollbar scroll-smooth touch-pan-x overscroll-x-contain lg:px-1"
                    >
                        {children}
                    </div>
                    <button
                        type="button"
                        onClick={() => scroll(1)}
                        disabled={!canScrollRight}
                        aria-label={t('homeDashboard.scrollRowRight', { title })}
                        className="hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 items-center justify-center rounded-full bg-black/70 border border-white/10 text-text hover:bg-black/90 hover:border-plex/50 disabled:opacity-0 disabled:pointer-events-none transition-all shadow-lg -mr-1"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            )}
        </div>
    );
};
