import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useDiscoverI18n } from './i18n';

interface CarouselProps {
    children: React.ReactNode;
    /** Poster rows scale the focused card. Other carousels (cast) stay flat. */
    posterRow?: boolean;
    /** Line the first card up with the page content (no extra rail inset). */
    flush?: boolean;
}

const SCROLL_EDGE_PX = 8;

const scrollPageFromWheel = (from: HTMLElement, deltaY: number) => {
    const named = document.getElementById('media-player-scroll')
        || document.getElementById('main-scroll-container');
    if (named) {
        named.scrollTop += deltaY;
        return;
    }
    let el: HTMLElement | null = from.parentElement;
    while (el && el !== document.body) {
        const overflowY = window.getComputedStyle(el).overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 8) {
            el.scrollTop += deltaY;
            return;
        }
        el = el.parentElement;
    }
    window.scrollBy(0, deltaY);
};

const isTvShell = () => {
    try {
        return document.documentElement?.dataset?.tv === '1'
            || window.__PLEX_CLIENT__?.isTv === true;
    } catch {
        return false;
    }
};

export const Carousel: React.FC<CarouselProps> = ({ children, posterRow = false, flush = false }) => {
    const { t } = useDiscoverI18n();
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(true);
    const [canScroll, setCanScroll] = useState(false);
    const [tvShell, setTvShell] = useState(false);

    useEffect(() => {
        setTvShell(isTvShell());
    }, []);

    const handleScroll = useCallback(() => {
        const node = scrollContainerRef.current;
        if (!node) return;
        const { scrollLeft, scrollWidth, clientWidth } = node;
        const overflow = scrollWidth > clientWidth + SCROLL_EDGE_PX;
        setCanScroll(overflow);
        if (!overflow) {
            setAtStart(true);
            setAtEnd(true);
            return;
        }
        const maxScroll = Math.max(0, scrollWidth - clientWidth);
        setAtStart(scrollLeft <= SCROLL_EDGE_PX);
        setAtEnd(scrollLeft >= maxScroll - SCROLL_EDGE_PX);
    }, []);

    useEffect(() => {
        handleScroll();
        const node = scrollContainerRef.current;
        if (!node) return undefined;

        const resizeObserver = typeof ResizeObserver !== 'undefined'
            ? new ResizeObserver(() => handleScroll())
            : null;
        resizeObserver?.observe(node);
        window.addEventListener('resize', handleScroll);

        const mutationObserver = typeof MutationObserver !== 'undefined'
            ? new MutationObserver(() => handleScroll())
            : null;
        mutationObserver?.observe(node, { childList: true, subtree: true });

        const onWheel = (event: WheelEvent) => {
            if (isTvShell()) return;
            if (event.shiftKey) return;
            if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            // Chrome turns vertical wheel into row-scroll on overflow-x. Keep the page moving.
            event.preventDefault();
            scrollPageFromWheel(node, event.deltaY);
        };
        node.addEventListener('wheel', onWheel, { passive: false });

        const t1 = window.setTimeout(handleScroll, 100);
        const t2 = window.setTimeout(handleScroll, 400);

        return () => {
            resizeObserver?.disconnect();
            mutationObserver?.disconnect();
            window.removeEventListener('resize', handleScroll);
            node.removeEventListener('wheel', onWheel);
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [children, handleScroll]);

    const scroll = (direction: 'left' | 'right') => {
        const node = scrollContainerRef.current;
        if (!node || !canScroll) return;
        const { clientWidth } = node;
        const page = Math.max(clientWidth - 100, 160);

        if (direction === 'right') {
            if (atEnd) return;
            node.scrollBy({ left: page, behavior: 'smooth' });
            return;
        }
        if (atStart) return;
        node.scrollBy({ left: -page, behavior: 'smooth' });
    };

    return (
        <div className="relative w-full min-w-0">
            <div className="player-rail-arrows absolute right-1 -top-9 z-10 flex items-center text-muted max-md:hidden">
                <button
                    type="button"
                    tabIndex={tvShell ? -1 : undefined}
                    onClick={() => scroll('left')}
                    disabled={!canScroll || atStart}
                    className={`p-0.5 transition-colors ${!canScroll || atStart ? 'text-muted/30 cursor-default' : 'hover:text-text'}`}
                    aria-label={t('common.scrollLeft')}
                >
                    <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                    type="button"
                    tabIndex={tvShell ? -1 : undefined}
                    onClick={() => scroll('right')}
                    disabled={!canScroll || atEnd}
                    className={`p-0.5 transition-colors ${!canScroll || atEnd ? 'text-muted/30 cursor-default' : 'text-text/80 hover:text-text'}`}
                    aria-label={t('common.scrollRight')}
                >
                    <ChevronRight className="w-6 h-6" />
                </button>
            </div>

            <div className="relative">
                <div
                    ref={scrollContainerRef}
                    onScroll={handleScroll}
                    data-tv-rail="1"
                    data-tv-poster-rail={posterRow ? '1' : undefined}
                    className={`flex gap-4 overflow-x-auto scrollbar-hide hide-scrollbar w-full ${
                        tvShell ? '' : 'snap-x snap-proximity'
                    } ${
                        flush || tvShell
                            ? (tvShell ? 'px-0 py-5' : 'px-0 py-2')
                            : tvShell ? (posterRow ? 'px-5 py-5' : 'px-4 py-3') : 'px-0 py-2'
                    }`}
                    style={{
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                        ...(tvShell ? { scrollSnapType: 'none' } : null),
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
};
