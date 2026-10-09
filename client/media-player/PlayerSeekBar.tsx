import React, { useState } from 'react';
import { formatClock } from './playerUtils';
import type { PlayerMarkers } from './types';

type BufferedRange = { startMs: number; endMs: number };

type Props = {
    currentMs: number;
    durationMs: number;
    buffered?: BufferedRange[];
    markers?: PlayerMarkers;
    previewThumbTemplate?: string | null;
    label: string;
    onSeek: (ms: number) => void;
};

const ratioFromEvent = (event: { clientX: number }, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
};

export const PlayerSeekBar: React.FC<Props> = ({
    currentMs,
    durationMs,
    buffered = [],
    markers,
    previewThumbTemplate,
    label,
    onSeek,
}) => {
    const [hover, setHover] = useState<{ ratio: number; x: number } | null>(null);
    const duration = Math.max(0, durationMs);
    const progress = duration > 0 ? Math.min(100, Math.max(0, (currentMs / duration) * 100)) : 0;
    const hoverMs = hover && duration ? hover.ratio * duration : null;

    const applyPointer = (event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>, seek: boolean) => {
        const ratio = ratioFromEvent(event, event.currentTarget);
        const rect = event.currentTarget.getBoundingClientRect();
        setHover({ ratio, x: event.clientX - rect.left });
        if (seek && duration) onSeek(ratio * duration);
    };

    return (
        <div className="relative pt-2">
            <div
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration / 1000)}
                aria-valuenow={Math.round(currentMs / 1000)}
                className="group relative h-5 cursor-pointer"
                onMouseMove={(event) => applyPointer(event, false)}
                onMouseLeave={() => setHover(null)}
                onClick={(event) => applyPointer(event, true)}
                onKeyDown={(event) => {
                    if (!duration) return;
                    if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        onSeek(Math.max(0, currentMs - 5000));
                    }
                    if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        onSeek(Math.min(duration, currentMs + 5000));
                    }
                }}
            >
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 group-hover:h-2">
                    {buffered.map((range, index) => (
                        <div
                            key={`${range.startMs}-${index}`}
                            className="absolute inset-y-0 bg-white/35"
                            style={{
                                left: `${duration ? (range.startMs / duration) * 100 : 0}%`,
                                width: `${duration ? ((range.endMs - range.startMs) / duration) * 100 : 0}%`,
                            }}
                        />
                    ))}
                    <div className="absolute inset-y-0 left-0 bg-plex" style={{ width: `${progress}%` }} />
                </div>
                {markers?.intro && duration ? (
                    <div
                        className="pointer-events-none absolute top-1/2 z-10 h-3 w-0.5 -translate-y-1/2 rounded-full bg-amber-300"
                        style={{ left: `${(markers.intro.startMs / duration) * 100}%` }}
                        title="Intro"
                    />
                ) : null}
                {markers?.credits && duration ? (
                    <div
                        className="pointer-events-none absolute top-1/2 z-10 h-3 w-0.5 -translate-y-1/2 rounded-full bg-sky-300"
                        style={{ left: `${(markers.credits.startMs / duration) * 100}%` }}
                        title="Credits"
                    />
                ) : null}
            </div>
            {hover && hoverMs != null ? (
                <div
                    className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 rounded-md bg-black/90 px-2 py-1 text-[11px] font-bold text-white shadow-lg"
                    style={{ left: hover.x, top: previewThumbTemplate ? -86 : undefined }}
                >
                    {previewThumbTemplate ? (
                        <img
                            alt=""
                            className="mb-1 h-16 w-28 rounded object-cover"
                            src={previewThumbTemplate.replace('__OFFSET__', String(Math.max(0, Math.round(hoverMs))))}
                        />
                    ) : null}
                    {formatClock(hoverMs)}
                </div>
            ) : null}
        </div>
    );
};
