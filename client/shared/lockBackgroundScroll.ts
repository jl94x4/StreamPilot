/**
 * Freeze the page behind a modal.
 *
 * On desktop, Discover scrolls `#main-scroll-container`. On mobile the
 * document itself scrolls (`min-h-screen` without overflow-hidden). iOS
 * Safari will pan that page through a position:fixed overlay unless we
 * both hide overflow and cancel unmatched touchmoves.
 */

export const MODAL_SCROLL_ATTR = 'data-modal-scroll';

type OverflowYFn = (el: { nodeName?: string }) => string;

type ScrollBox = {
    id?: string;
    nodeName?: string;
    scrollTop: number;
    clientHeight: number;
    scrollHeight: number;
    parentElement?: ScrollBox | null;
    hasAttribute?: (name: string) => boolean;
};

let lockCount = 0;
let saved: {
    htmlOverflow: string;
    htmlOverscroll: string;
    bodyOverflow: string;
    bodyOverscroll: string;
    mainOverflow: string;
    mainTouchAction: string;
} | null = null;
let lastTouchY = 0;
let touchStartHandler: ((event: TouchEvent) => void) | null = null;
let touchMoveHandler: ((event: TouchEvent) => void) | null = null;

export const elementCanScroll = (el: ScrollBox | null | undefined, deltaY: number): boolean => {
    if (!el) return false;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max <= 0) return false;
    if (deltaY > 0) return el.scrollTop < max - 1;
    if (deltaY < 0) return el.scrollTop > 0;
    return true;
};

export const isPageBackgroundScroller = (el: ScrollBox | null | undefined): boolean => {
    if (!el) return true;
    if (el.id === 'main-scroll-container') return true;
    const name = String(el.nodeName || '').toUpperCase();
    return name === 'HTML' || name === 'BODY';
};

export const isAllowedModalScroller = (el: ScrollBox | null | undefined, getOverflowY?: OverflowYFn): boolean => {
    if (!el || isPageBackgroundScroller(el)) return false;
    if (el.hasAttribute?.(MODAL_SCROLL_ATTR)) return true;
    const overflowY = getOverflowY ? getOverflowY(el) : '';
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

const asScrollBox = (target: EventTarget | null): ScrollBox | null => {
    if (!target || typeof target !== 'object') return null;
    // Text nodes are not scroll boxes; start from their parent.
    if (typeof Node !== 'undefined' && typeof Element !== 'undefined'
        && target instanceof Node && !(target instanceof Element)) {
        return (target.parentElement as unknown as ScrollBox) || null;
    }
    return target as unknown as ScrollBox;
};

export const shouldPreventBackgroundTouch = (
    target: EventTarget | null,
    deltaY: number,
    getOverflowY?: OverflowYFn,
): boolean => {
    let node = asScrollBox(target);
    while (node) {
        if (isAllowedModalScroller(node, getOverflowY) && elementCanScroll(node, deltaY)) {
            return false;
        }
        node = node.parentElement || null;
    }
    return true;
};

const readOverflowY = (el: { nodeName?: string }) => {
    if (typeof window === 'undefined' || !(el instanceof Element)) return '';
    return window.getComputedStyle(el).overflowY;
};

export const lockBackgroundScroll = (): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;

    const html = document.documentElement;
    const body = document.body;
    const main = document.getElementById('main-scroll-container');

    if (lockCount === 0) {
        saved = {
            htmlOverflow: html.style.overflow,
            htmlOverscroll: html.style.overscrollBehavior,
            bodyOverflow: body.style.overflow,
            bodyOverscroll: body.style.overscrollBehavior,
            mainOverflow: main?.style.overflow || '',
            mainTouchAction: main?.style.touchAction || '',
        };
        html.style.overflow = 'hidden';
        html.style.overscrollBehavior = 'none';
        body.style.overflow = 'hidden';
        body.style.overscrollBehavior = 'none';
        if (main) {
            main.style.overflow = 'hidden';
            main.style.touchAction = 'none';
        }

        touchStartHandler = (event: TouchEvent) => {
            lastTouchY = event.touches[0]?.clientY || 0;
        };
        touchMoveHandler = (event: TouchEvent) => {
            if (!event.cancelable) return;
            const y = event.touches[0]?.clientY || 0;
            const deltaY = lastTouchY - y;
            lastTouchY = y;
            if (shouldPreventBackgroundTouch(event.target, deltaY, readOverflowY)) {
                event.preventDefault();
            }
        };
        document.addEventListener('touchstart', touchStartHandler, { passive: true, capture: true });
        document.addEventListener('touchmove', touchMoveHandler, { passive: false, capture: true });
    }
    lockCount += 1;

    let released = false;
    return () => {
        if (released) return;
        released = true;
        lockCount = Math.max(0, lockCount - 1);
        if (lockCount > 0 || !saved) return;
        html.style.overflow = saved.htmlOverflow;
        html.style.overscrollBehavior = saved.htmlOverscroll;
        body.style.overflow = saved.bodyOverflow;
        body.style.overscrollBehavior = saved.bodyOverscroll;
        if (main) {
            main.style.overflow = saved.mainOverflow;
            main.style.touchAction = saved.mainTouchAction;
        }
        if (touchStartHandler) {
            document.removeEventListener('touchstart', touchStartHandler, true);
            touchStartHandler = null;
        }
        if (touchMoveHandler) {
            document.removeEventListener('touchmove', touchMoveHandler, true);
            touchMoveHandler = null;
        }
        saved = null;
    };
};
