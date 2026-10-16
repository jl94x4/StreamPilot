import React from 'react';
import { PosterGridSizeSlider } from '../shared/PosterGridSizeSlider';
import type { PosterGridValue } from '../shared/portalLayout';
import { useDiscoverI18n } from './i18n';

export const DiscoverGridSizeSelect: React.FC<{
    value: PosterGridValue;
    onChange: (value: number) => void;
    className?: string;
}> = ({ value, onChange, className = '' }) => {
    const { t } = useDiscoverI18n();
    try {
        if (document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true) {
            return null;
        }
    } catch {
        /* ignore */
    }
    return (
        <PosterGridSizeSlider
            value={value}
            onChange={(next) => {
                if (typeof next === 'number') onChange(next);
            }}
            className={className}
            label={t('browse.gridSize')}
            listLabel={t('browse.gridList')}
        />
    );
};
