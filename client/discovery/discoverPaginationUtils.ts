import type { PosterGridValue } from '../shared/portalLayout';
import { estimatePortalContentWidth, posterGridScaleRem } from '../shared/portalLayout';

export const DISCOVER_INITIAL_ROW_COUNT = 5;
/** Expected titles per Seerr/TMDB discover page (used for initial-fill estimates). */
export const DISCOVER_API_PAGE_SIZE = 20;
/** Target titles appended on each infinite-scroll load. */
export const DISCOVER_LOAD_MORE_TARGET = 30;

export const estimateDiscoverGridColumns = (gridSize: PosterGridValue, containerWidth: number): number => {
    if (gridSize === 'list') return 1;
    if (containerWidth <= 0) return 8;
    const minPx = posterGridScaleRem(gridSize) * 16;
    const gap = 16;
    return Math.max(2, Math.floor((containerWidth + gap) / (minPx + gap)));
};

export const initialDiscoverPagesForGrid = (gridSize: PosterGridValue, containerWidth: number): number => {
    if (gridSize === 'list') {
        return DISCOVER_INITIAL_ROW_COUNT;
    }
    const targetItems = estimateDiscoverGridColumns(gridSize, containerWidth) * DISCOVER_INITIAL_ROW_COUNT;
    return Math.max(1, Math.ceil(targetItems / DISCOVER_API_PAGE_SIZE));
};

export const discoverSkeletonCountForGrid = (gridSize: PosterGridValue, containerWidth: number): number => {
    if (gridSize === 'list') return DISCOVER_INITIAL_ROW_COUNT * 3;
    const width = containerWidth > 0 ? containerWidth : estimatePortalContentWidth();
    return estimateDiscoverGridColumns(gridSize, width) * DISCOVER_INITIAL_ROW_COUNT;
};
