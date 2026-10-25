import React, { Suspense, useState } from 'react';

type ScreenLoader<P> = () => Promise<React.ComponentType<P>>;

export type LazyScreen<P> = React.FC<P> & {
    /** Fetch the screen's code ahead of time (idle prefetch). Safe to call repeatedly. */
    preload: () => Promise<React.ComponentType<P>>;
};

/**
 * A screen kept out of the start-up script. Once its code is loaded (opened before, or
 * preloaded at idle) it renders straight away; otherwise it shows nothing until the chunk
 * arrives. Each mount keeps the component it started with, so a screen never remounts
 * (and loses state) because its code finished loading underneath it.
 */
export const lazyScreen = <P extends object>(load: ScreenLoader<P>): LazyScreen<P> => {
    let loaded: React.ComponentType<P> | null = null;
    let pending: Promise<React.ComponentType<P>> | null = null;
    const preload = () => {
        if (!pending) {
            pending = load().then((component) => {
                loaded = component;
                return component;
            });
            pending.catch(() => { pending = null; });
        }
        return pending;
    };
    const Lazy = React.lazy(() => preload().then((component) => ({ default: component })));
    const Screen: React.FC<P> = (props) => {
        const [Ready] = useState(() => loaded);
        if (Ready) return <Ready {...props} />;
        const LazyComponent = Lazy as unknown as React.ComponentType<P>;
        return (
            <Suspense fallback={null}>
                <LazyComponent {...props} />
            </Suspense>
        );
    };
    return Object.assign(Screen, { preload });
};

/** Load screens one after another while the device is idle, after start-up has settled. */
export const preloadScreensWhenIdle = (screens: Array<{ preload: () => Promise<unknown> }>, delayMs = 4000) => {
    let cancelled = false;
    const idle = (fn: () => void) => {
        const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
            .requestIdleCallback;
        if (ric) ric(fn, { timeout: 2000 });
        else window.setTimeout(fn, 200);
    };
    const next = (index: number) => {
        if (cancelled || index >= screens.length) return;
        idle(() => {
            if (cancelled) return;
            void screens[index].preload().catch(() => undefined).then(() => next(index + 1));
        });
    };
    const timer = window.setTimeout(() => next(0), delayMs);
    return () => {
        cancelled = true;
        window.clearTimeout(timer);
    };
};
