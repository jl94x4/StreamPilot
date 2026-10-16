import { useEffect, useState } from 'react';
import {
    DEFAULT_POSTER_GRID_SCALE,
    parsePosterGridValue,
} from '../shared/portalLayout';

export const DISCOVERY_GRID_SIZE_STORAGE_KEY = 'discoveryGridSize.v2';

export const useDiscoverGridSize = () => {
    const [gridSize, setGridSize] = useState<number>(() => {
        if (typeof window === 'undefined') return DEFAULT_POSTER_GRID_SCALE;
        const parsed = parsePosterGridValue(window.localStorage.getItem(DISCOVERY_GRID_SIZE_STORAGE_KEY));
        return typeof parsed === 'number' ? parsed : DEFAULT_POSTER_GRID_SCALE;
    });

    useEffect(() => {
        window.localStorage.setItem(DISCOVERY_GRID_SIZE_STORAGE_KEY, String(gridSize));
    }, [gridSize]);

    return [gridSize, setGridSize] as const;
};
