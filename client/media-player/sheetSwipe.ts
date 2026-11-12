import type { TouchEvent } from 'react';

type SwipeState = { y: number; dy: number; t: number; live: boolean };

/**
 * Touch handlers that let a phone bottom sheet be dragged down to dismiss.
 * Spread onto the sheet element. A drag counts when it starts outside a `[data-sheet-list]`
 * scroller, or inside one that is scrolled to the top.
 */
export function createSheetSwipe(close: () => void) {
    let state: SwipeState | null = null;
    return {
        onTouchStart: (event: TouchEvent<HTMLElement>) => {
            const list = event.currentTarget.querySelector('[data-sheet-list]') as HTMLElement | null;
            const inList = list?.contains(event.target as Node) ?? false;
            state = {
                y: event.touches[0].clientY,
                dy: 0,
                t: Date.now(),
                live: !inList || (list?.scrollTop ?? 0) <= 0,
            };
        },
        onTouchMove: (event: TouchEvent<HTMLElement>) => {
            const s = state;
            if (!s || !s.live) return;
            const dy = event.touches[0].clientY - s.y;
            if (dy <= 0) {
                s.dy = 0;
                event.currentTarget.style.transform = '';
                return;
            }
            s.dy = dy;
            event.currentTarget.style.transition = 'none';
            event.currentTarget.style.transform = `translateY(${dy}px)`;
        },
        onTouchEnd: (event: TouchEvent<HTMLElement>) => {
            const s = state;
            state = null;
            const el = event.currentTarget;
            if (!s || !s.live || s.dy <= 0) return;
            const fast = s.dy / Math.max(1, Date.now() - s.t) > 0.5;
            el.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
            if (s.dy > 110 || (fast && s.dy > 30)) {
                el.style.transform = 'translateY(100%)';
                window.setTimeout(close, 200);
            } else {
                el.style.transform = '';
            }
        },
    };
}
