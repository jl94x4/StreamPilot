import React, { useCallback, useRef } from 'react';
import { Check } from 'lucide-react';
import {
    discoverSelection,
    useDiscoverCellSelected,
    useDiscoverSelectMode,
} from './discoverViewState';

const LONG_PRESS_MS = 520;
const MOVE_TOLERANCE = 10;

/**
 * Wraps one grid/list item. While Select mode is on, a tap toggles the item instead of opening it.
 * On touch screens a long press starts Select mode with that item ticked.
 */
export const DiscoverSelectable: React.FC<{
    itemKey: string;
    item: any;
    selectable?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}> = ({ itemKey, item, selectable = true, className = '', style, children }) => {
    const selectMode = useDiscoverSelectMode();
    const selected = useDiscoverCellSelected(itemKey);
    const timerRef = useRef<number | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const swallowClickRef = useRef(false);

    const cancelPress = useCallback(() => {
        if (timerRef.current != null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startRef.current = null;
    }, []);

    const onPointerDown = useCallback((event: React.PointerEvent) => {
        if (!selectable || event.pointerType !== 'touch') return;
        startRef.current = { x: event.clientX, y: event.clientY };
        cancelPress();
        startRef.current = { x: event.clientX, y: event.clientY };
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            swallowClickRef.current = true;
            try { navigator.vibrate?.(12); } catch { /* ignore */ }
            discoverSelection.enter(itemKey, item);
        }, LONG_PRESS_MS);
    }, [cancelPress, item, itemKey, selectable]);

    const onPointerMove = useCallback((event: React.PointerEvent) => {
        const start = startRef.current;
        if (!start) return;
        if (Math.abs(event.clientX - start.x) > MOVE_TOLERANCE || Math.abs(event.clientY - start.y) > MOVE_TOLERANCE) {
            cancelPress();
        }
    }, [cancelPress]);

    const onClickCapture = useCallback((event: React.MouseEvent) => {
        if (swallowClickRef.current) {
            swallowClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (selectMode && selectable) {
            event.preventDefault();
            event.stopPropagation();
            discoverSelection.toggle(itemKey, item);
        }
    }, [item, itemKey, selectMode, selectable]);

    return (
        <div
            className={`relative ${className}`.trim()}
            style={{ WebkitTouchCallout: 'none', ...style }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
            onClickCapture={onClickCapture}
            onContextMenu={(event) => {
                // iOS/Android long-press would otherwise open the image/link menu.
                if (selectMode || timerRef.current != null || swallowClickRef.current) event.preventDefault();
            }}
        >
            {children}
            {selectMode && selectable ? (
                <>
                    <div
                        className={`pointer-events-none absolute inset-0 z-30 rounded-[12px] border-2 transition-colors ${
                            selected ? 'border-plex bg-plex/15' : 'border-transparent'
                        }`}
                        aria-hidden
                    />
                    <span
                        className={`pointer-events-none absolute left-1.5 top-1.5 z-40 flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                            selected ? 'border-plex bg-plex text-black' : 'border-white/70 bg-black/45 text-transparent'
                        }`}
                        aria-hidden
                    >
                        <Check className="h-3 w-3" strokeWidth={3.5} />
                    </span>
                </>
            ) : null}
        </div>
    );
};
