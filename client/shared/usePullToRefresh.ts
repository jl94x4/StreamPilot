import { useEffect, useRef, useState } from 'react';

const THRESHOLD_PX = 72;
const MAX_PULL_PX = 120;

const getHomeScrollTop = () => {
    const el = typeof document === 'undefined' ? null : document.getElementById('main-scroll-container');
    if (el) {
        const overflowY = typeof window !== 'undefined' ? window.getComputedStyle(el).overflowY : '';
        if (overflowY === 'auto' || overflowY === 'scroll') return el.scrollTop;
    }
    if (typeof window === 'undefined') return 0;
    return window.scrollY || document.documentElement.scrollTop || 0;
};

type Options = {
    enabled?: boolean;
    busy?: boolean;
};

export const usePullToRefresh = (onRefresh: () => Promise<void> | void, options: Options = {}) => {
    const { enabled = true, busy = false } = options;
    const [pullPx, setPullPx] = useState(0);
    const onRefreshRef = useRef(onRefresh);
    const busyRef = useRef(busy);
    onRefreshRef.current = onRefresh;
    busyRef.current = busy;

    useEffect(() => {
        if (!enabled) return;

        let startY = 0;
        let pulling = false;
        let current = 0;

        const reset = () => {
            pulling = false;
            current = 0;
            setPullPx(0);
        };

        const onStart = (event: TouchEvent) => {
            if (busyRef.current) return;
            if (getHomeScrollTop() > 4) return;
            startY = event.touches[0]?.clientY || 0;
            pulling = true;
            current = 0;
        };

        const onMove = (event: TouchEvent) => {
            if (!pulling || busyRef.current) return;
            if (getHomeScrollTop() > 4) {
                reset();
                return;
            }
            const dy = (event.touches[0]?.clientY || 0) - startY;
            if (dy <= 0) {
                current = 0;
                setPullPx(0);
                return;
            }
            current = Math.min(MAX_PULL_PX, dy * 0.45);
            setPullPx(current);
        };

        const onEnd = () => {
            if (!pulling) return;
            const shouldRefresh = current >= THRESHOLD_PX && !busyRef.current;
            reset();
            if (!shouldRefresh) return;
            void Promise.resolve(onRefreshRef.current());
        };

        window.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd, { passive: true });
        window.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            window.removeEventListener('touchstart', onStart);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
        };
    }, [enabled]);

    return { pullPx, pulling: pullPx > 8 };
};
