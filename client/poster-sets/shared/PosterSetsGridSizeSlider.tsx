import React from 'react';
import { PosterGridSizeSlider } from '../../shared/PosterGridSizeSlider';
import type { PosterGridValue } from '../../shared/portalLayout';
import { DEFAULT_POSTER_SETS_GRID_SIZE } from './posterSetsUi';

export const PosterSetsGridSizeSlider: React.FC<{
    value: PosterGridValue;
    onChange: (value: number) => void;
    className?: string;
}> = ({ value, onChange, className }) => (
    <PosterGridSizeSlider
        value={value === 'list' ? DEFAULT_POSTER_SETS_GRID_SIZE : value}
        onChange={(next) => {
            if (typeof next === 'number') onChange(next);
        }}
        className={className}
    />
);
