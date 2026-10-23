import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { PLAYER_SCROLL_ID } from './paths';

const TRIGGER_PX = 72;
const MAX_PULL_PX = 110;

/**
 * Phone pull-to-refresh for #media-player-scroll. Pulls only start at scrollTop 0,
 * so it never fights a normal scroll or a sideways row swipe.
 */
export const PlayerPullToRefresh: React.FC<{
    enabled: boolean;
    onRefresh: () => Promise<unknown>;
}> = ({ enabled, onRefresh }) => {
    const [pull, setPull] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const refreshRef = useRef(onRefresh);
    refreshRef.current = onRefresh;

    useEffect(() => {
        if (!enabled) return undefined;
        const scroller = document.getElementById(PLAYER_SCROLL_ID);
        if (!scroller) return undefined;
        let startY = -1;
        let startX = 0;
        let distance = 0;
        let busy = false;
        const reset = () => {
            startY = -1;
            distance = 0;
            setPull(0);
        };
        const onStart = (event: TouchEvent) => {
            if (busy || event.touches.length !== 1 || scroller.scrollTop > 0) return;
            startY = event.touches[0].clientY;
            startX = event.touches[0].clientX;
            distance = 0;
        };
        const onMove = (event: TouchEvent) => {
            if (startY < 0) return;
            const dy = event.touches[0].clientY - startY;
            const dx = Math.abs(event.touches[0].clientX - startX);
            if (dy <= 0) {
                if (distance) {
                    distance = 0;
                    setPull(0);
                }
                return;
            }
            // A row swipe or a page that has started scrolling is not a pull.
            if (scroller.scrollTop > 0 || dx > dy) {
                reset();
                return;
            }
            // Ease off so the indicator lags the finger like native pulls.
            distance = Math.min(MAX_PULL_PX, dy * 0.55);
            setPull(distance);
        };
        const onEnd = () => {
            if (startY < 0) return;
            const fire = distance >= TRIGGER_PX;
            reset();
            if (!fire) return;
            busy = true;
            setRefreshing(true);
            void refreshRef.current()
                .catch(() => undefined)
                .finally(() => {
                    busy = false;
                    setRefreshing(false);
                });
        };
        scroller.addEventListener('touchstart', onStart, { passive: true });
        scroller.addEventListener('touchmove', onMove, { passive: true });
        scroller.addEventListener('touchend', onEnd, { passive: true });
        scroller.addEventListener('touchcancel', reset, { passive: true });
        return () => {
            scroller.removeEventListener('touchstart', onStart);
            scroller.removeEventListener('touchmove', onMove);
            scroller.removeEventListener('touchend', onEnd);
            scroller.removeEventListener('touchcancel', reset);
        };
    }, [enabled]);

    if (!enabled || (!pull && !refreshing)) return null;
    const offset = refreshing ? TRIGGER_PX * 0.75 : pull;
    const armed = refreshing || pull >= TRIGGER_PX;
    return (
        <div
            className="pointer-events-none fixed left-0 right-0 z-40 flex justify-center"
            style={{ top: `calc(2.4rem + env(safe-area-inset-top, 0px) + ${offset - 40}px)` }}
            aria-live="polite"
        >
            <span
                className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#141a24] shadow-lg ${
                    armed ? 'text-plex' : 'text-white/60'
                }`}
                style={{ opacity: Math.min(1, offset / TRIGGER_PX) }}
            >
                <RefreshCw
                    className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                    style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
                />
            </span>
        </div>
    );
};
