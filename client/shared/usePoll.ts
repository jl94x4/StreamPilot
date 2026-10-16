import { useCallback, useEffect, useRef, useState } from 'react';

/** True when the document tab is visible (or SSR-safe default). */
export function useDocumentVisible(defaultVisible = true): boolean {
    const [visible, setVisible] = useState(() =>
        typeof document === 'undefined' ? defaultVisible : document.visibilityState !== 'hidden',
    );

    useEffect(() => {
        const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    return visible;
}

export type UsePollOptions = {
    /** When false, polling is disabled entirely. Default true. */
    enabled?: boolean;
    /** Run once when polling starts. Default true. */
    immediate?: boolean;
    /** Skip ticks while the tab is hidden. Default true. */
    pauseWhenHidden?: boolean;
};

/**
 * Interval polling with optional tab-visibility pause.
 * Pass null/undefined intervalMs to disable.
 */
export function usePoll(
    callback: () => void | Promise<void>,
    intervalMs: number | null | undefined,
    options: UsePollOptions = {},
): void {
    const { enabled = true, immediate = true, pauseWhenHidden = true } = options;
    const visible = useDocumentVisible();
    const callbackRef = useRef(callback);
    callbackRef.current = callback;

    useEffect(() => {
        if (!enabled || !intervalMs || intervalMs <= 0) return undefined;

        const shouldRun = () => !pauseWhenHidden || visible;
        const tick = () => {
            if (shouldRun()) void callbackRef.current();
        };

        if (immediate && shouldRun()) void callbackRef.current();

        const timerId = window.setInterval(tick, intervalMs);
        return () => window.clearInterval(timerId);
    }, [enabled, immediate, intervalMs, pauseWhenHidden, visible]);
}

/** Invalidate in-flight async work when a newer poll/generation starts. */
export function usePollGuard() {
    const generationRef = useRef(0);

    const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
        const generation = ++generationRef.current;
        try {
            const result = await fn();
            if (generation !== generationRef.current) return undefined;
            return result;
        } catch (error) {
            if (generation !== generationRef.current) return undefined;
            throw error;
        }
    }, []);

    const invalidate = useCallback(() => {
        generationRef.current += 1;
    }, []);

    return { guard, invalidate, generationRef };
}
