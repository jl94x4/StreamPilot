/** Desktop Poster Sets scrolls `#main-scroll-container`; mobile uses the document. */

const MAIN_SCROLL_ID = 'main-scroll-container';

export type PortalScrollSnapshot = {
    top: number;
    mode: 'container' | 'window';
};

const containerIsScroller = (container: HTMLElement | null) => {
    if (!container || typeof window === 'undefined') return false;
    const overflowY = window.getComputedStyle(container).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

export const capturePortalScroll = (): PortalScrollSnapshot => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return { top: 0, mode: 'window' };
    }
    const container = document.getElementById(MAIN_SCROLL_ID);
    if (container && containerIsScroller(container)) {
        return { top: Math.max(0, Math.round(container.scrollTop || 0)), mode: 'container' };
    }
    return {
        top: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0)),
        mode: 'window',
    };
};

export const restorePortalScroll = (snapshot?: PortalScrollSnapshot | null) => {
    if (!snapshot || typeof window === 'undefined') return;
    const top = Math.max(0, Number(snapshot.top) || 0);
    const container = typeof document !== 'undefined' ? document.getElementById(MAIN_SCROLL_ID) : null;
    if (container) container.scrollTop = top;
    window.scrollTo(0, top);
};

/** Hash writes on Safari/iOS jump the viewport; restore after history updates. */
export const withPreservedPortalScroll = (write: () => void) => {
    const snapshot = capturePortalScroll();
    write();
    restorePortalScroll(snapshot);
    scheduleScrollRestore(() => restorePortalScroll(snapshot));
};

export const scheduleScrollRestore = (
    restore: () => void,
    { frames = 2, delays = [0, 50, 160] }: { frames?: number; delays?: number[] } = {},
) => {
    if (typeof window === 'undefined') {
        restore();
        return;
    }
    let remaining = Math.max(1, frames);
    const tick = () => {
        restore();
        remaining -= 1;
        if (remaining > 0) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    for (const ms of delays) window.setTimeout(restore, ms);
};

export const captureElementScroll = (el?: HTMLElement | null) => (
    Math.max(0, Math.round(el?.scrollTop || 0))
);

export const restoreElementScroll = (el: HTMLElement | null | undefined, top: number) => {
    if (!el) return;
    el.scrollTop = Math.max(0, Number(top) || 0);
};
