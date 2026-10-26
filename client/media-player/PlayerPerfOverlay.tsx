import React, { useEffect, useRef, useState } from 'react';

/**
 * Diagnostics for TV row changes (Settings → Display → Diagnostics): an on-screen frame
 * meter, plus switches that turn off the billboard art or the poster focus effect so their
 * cost can be compared on a real TV. Off by default; stored per device.
 */
const PERF_KEY = 'smp-perf-diagnostics';
export const PERF_FLAGS_EVENT = 'smp-perf-flags';

export type PerfFlags = { overlay: boolean; noBillboard: boolean; noFocusFx: boolean };

const DEFAULT_FLAGS: PerfFlags = { overlay: false, noBillboard: false, noFocusFx: false };

export const readPerfFlags = (): PerfFlags => {
    try {
        return { ...DEFAULT_FLAGS, ...(JSON.parse(localStorage.getItem(PERF_KEY) || '{}') as Partial<PerfFlags>) };
    } catch {
        return { ...DEFAULT_FLAGS };
    }
};

/** Mirror the switches onto <html> so plain CSS can turn the effects off. */
export const applyPerfFlags = (flags: PerfFlags = readPerfFlags()) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (flags.noBillboard) root.dataset.perfNoBillboard = '1';
    else delete root.dataset.perfNoBillboard;
    if (flags.noFocusFx) root.dataset.perfNoFocusFx = '1';
    else delete root.dataset.perfNoFocusFx;
};

export const writePerfFlags = (patch: Partial<PerfFlags>) => {
    const next = { ...readPerfFlags(), ...patch };
    try {
        localStorage.setItem(PERF_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable */
    }
    applyPerfFlags(next);
    window.dispatchEvent(new CustomEvent(PERF_FLAGS_EVENT, { detail: next }));
    return next;
};

/** Fired by the TV remote on Up / Down between Home or library rows. */
const ROW_EVENT = 'smp-tv-home-row';
const SAMPLE_MS = 800;
const FRAME_MS = 1000 / 60;

type PressStats = { worst: number; dropped: number };

const summarise = (deltas: number[]): PressStats => ({
    worst: deltas.length ? Math.max(...deltas) : 0,
    dropped: deltas.reduce((sum, delta) => sum + Math.max(0, Math.round(delta / FRAME_MS) - 1), 0),
});

/** The app's Reduce motion setting, or Android's Remove animations (seen as prefers-reduced-motion). */
const motionLabel = () => {
    if (document.documentElement.dataset.reduceMotion === '1') return 'Reduce motion on';
    try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'Reduce motion on (system)';
    } catch {
        /* ignore */
    }
    return 'Motion on';
};

export const PlayerPerfOverlay: React.FC = () => {
    const [flags, setFlags] = useState<PerfFlags>(() => readPerfFlags());
    const [last, setLast] = useState<PressStats | null>(null);
    const [history, setHistory] = useState<PressStats[]>([]);
    const samplingRef = useRef(0);

    useEffect(() => {
        applyPerfFlags(flags);
        const onFlags = (event: Event) => setFlags((event as CustomEvent<PerfFlags>).detail || readPerfFlags());
        window.addEventListener(PERF_FLAGS_EVENT, onFlags);
        return () => window.removeEventListener(PERF_FLAGS_EVENT, onFlags);
    }, []);

    useEffect(() => {
        if (!flags.overlay) return undefined;
        const onRow = () => {
            const run = ++samplingRef.current;
            const deltas: number[] = [];
            const start = performance.now();
            let prev = start;
            const tick = (now: number) => {
                if (run !== samplingRef.current) return;
                deltas.push(now - prev);
                prev = now;
                if (now - start < SAMPLE_MS) {
                    requestAnimationFrame(tick);
                    return;
                }
                const stats = summarise(deltas);
                setLast(stats);
                setHistory((rows) => [...rows.slice(-9), stats]);
            };
            requestAnimationFrame(tick);
        };
        window.addEventListener(ROW_EVENT, onRow);
        return () => window.removeEventListener(ROW_EVENT, onRow);
    }, [flags.overlay]);

    if (!flags.overlay) return null;
    const avg = (pick: (row: PressStats) => number) => (
        history.length ? Math.round(history.reduce((sum, row) => sum + pick(row), 0) / history.length) : 0
    );
    return (
        <div className="smp-perf-overlay" aria-hidden>
            <p className="smp-perf-title">Row change</p>
            {last ? (
                <>
                    <p>
                        Last: slowest <strong>{Math.round(last.worst)} ms</strong> · dropped <strong>{last.dropped}</strong>
                    </p>
                    <p>
                        Avg of {history.length}: slowest <strong>{avg((row) => row.worst)} ms</strong> · dropped <strong>{avg((row) => row.dropped)}</strong>
                    </p>
                </>
            ) : (
                <p>Move up or down a row…</p>
            )}
            <p className="smp-perf-flags">
                {flags.noBillboard ? 'Billboard off · ' : ''}
                {flags.noFocusFx ? 'Focus effect off · ' : ''}
                {motionLabel()}
            </p>
        </div>
    );
};
