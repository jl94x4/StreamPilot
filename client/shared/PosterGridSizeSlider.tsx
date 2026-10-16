import React, { useEffect, useRef } from 'react';
import { LayoutList } from 'lucide-react';
import {
    DEFAULT_POSTER_GRID_SCALE,
    POSTER_GRID_SCALE_MAX,
    POSTER_GRID_SCALE_MIN,
    POSTER_GRID_SCALE_STEP,
    posterGridScaleRem,
    type PosterGridValue,
} from './portalLayout';

const sliderClass = 'h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-white/15 accent-plex sm:w-36 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-plex [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-plex';

export const PosterGridSizeSlider: React.FC<{
    value: PosterGridValue;
    onChange: (value: number | 'list') => void;
    allowList?: boolean;
    className?: string;
    label?: string;
    listLabel?: string;
}> = ({
    value,
    onChange,
    allowList = false,
    className = '',
    label = 'Size',
    listLabel = 'List',
}) => {
    const scale = posterGridScaleRem(value);
    const lastScaleRef = useRef(scale);
    useEffect(() => {
        if (value !== 'list') lastScaleRef.current = scale;
    }, [scale, value]);

    return (
        <div className={`inline-flex min-w-0 items-center gap-2 ${className}`.trim()}>
            <label className="flex min-w-0 items-center gap-2 text-[11px] font-semibold normal-case tracking-normal text-muted">
                <span className="shrink-0">{label}</span>
                <input
                    type="range"
                    min={POSTER_GRID_SCALE_MIN}
                    max={POSTER_GRID_SCALE_MAX}
                    step={POSTER_GRID_SCALE_STEP}
                    value={scale}
                    aria-label={label}
                    tabIndex={typeof document !== 'undefined' && document.documentElement?.dataset?.tv === '1' ? -1 : undefined}
                    className={sliderClass}
                    onInput={(event) => onChange(Number((event.target as HTMLInputElement).value))}
                    onChange={(event) => onChange(Number(event.target.value))}
                />
            </label>
            {allowList ? (
                <button
                    type="button"
                    aria-pressed={value === 'list'}
                    title={listLabel}
                    onClick={() => onChange(value === 'list' ? lastScaleRef.current || DEFAULT_POSTER_GRID_SCALE : 'list')}
                    className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold transition-colors ${
                        value === 'list'
                            ? 'border-plex/40 bg-plex/15 text-plex'
                            : 'border-white/10 bg-white/5 text-muted hover:text-text'
                    }`}
                >
                    <LayoutList className="h-3.5 w-3.5" />
                    {listLabel}
                </button>
            ) : null}
        </div>
    );
};
