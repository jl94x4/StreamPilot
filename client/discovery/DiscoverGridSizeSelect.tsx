import React from 'react';
import { PosterGridSizeSlider } from '../shared/PosterGridSizeSlider';
import type { PosterGridValue } from '../shared/portalLayout';
import { useDiscoverI18n } from './i18n';
import { DiscoverViewTools } from './DiscoverViewTools';
import { useDiscoverLayout } from './discoverViewState';

export const DiscoverGridSizeSelect: React.FC<{
    value: PosterGridValue;
    onChange: (value: number) => void;
    className?: string;
    /** Browse pages: add the Grid / List / Compact switch and Select button. */
    tools?: boolean;
}> = ({ value, onChange, className = '', tools = false }) => {
    const { t } = useDiscoverI18n();
    const [layout] = useDiscoverLayout();
    try {
        if (document.documentElement?.dataset?.tv === '1' || window.__PLEX_CLIENT__?.isTv === true) {
            return null;
        }
    } catch {
        /* ignore */
    }
    const slider = (
        <PosterGridSizeSlider
            value={value}
            onChange={(next) => {
                if (typeof next === 'number') onChange(next);
            }}
            className={tools ? '' : className}
            label={t('browse.gridSize')}
            listLabel={t('browse.gridList')}
        />
    );
    if (!tools) return slider;
    return (
        <div className={`inline-flex flex-wrap items-center gap-3 ${className}`.trim()}>
            {layout === 'grid' ? slider : null}
            <DiscoverViewTools />
        </div>
    );
};
