import type { CSSProperties } from 'react';
import {
    DEFAULT_POSTER_GRID_SCALE,
    parsePosterGridValue,
    POSTER_SETS_GRID_PRESET_SCALE,
    type PosterGridValue,
    upgraderLandscapeGridStyle,
    upgraderPosterGridStyle,
} from '../../shared/portalLayout';
import { dashboardPanelClass } from '../../shared/dashboard/DashboardChrome';
import { MEDIUX_FILTER_OPTIONS, type PosterSetsBrowseRail } from '../types';

export const POSTER_SETS_GRID_STORAGE_KEY = 'posterSetsGridSize.v4';
const POSTER_SETS_GRID_STORAGE_KEY_V3 = 'posterSetsGridSize.v3';
export const POSTER_SETS_LIBRARY_DETAIL_LAYOUT_KEY = 'posterSetsLibraryDetailLayout.v2';
export const DEFAULT_POSTER_SETS_GRID_SIZE = DEFAULT_POSTER_GRID_SCALE;

export const posterSetsPosterGridStyle = (size: PosterGridValue): CSSProperties => upgraderPosterGridStyle(size);

export const posterSetsLandscapeGridStyle = (size: PosterGridValue): CSSProperties => upgraderLandscapeGridStyle(size);

export const readStoredPosterSetsGridSize = (): number => {
    if (typeof window === 'undefined') return DEFAULT_POSTER_SETS_GRID_SIZE;
    const stored = window.localStorage.getItem(POSTER_SETS_GRID_STORAGE_KEY);
    const parsed = parsePosterGridValue(stored, { presets: POSTER_SETS_GRID_PRESET_SCALE });
    if (typeof parsed === 'number') return parsed;
    return parsePosterGridValue(
        window.localStorage.getItem(POSTER_SETS_GRID_STORAGE_KEY_V3),
        { presets: POSTER_SETS_GRID_PRESET_SCALE },
    ) as number;
};

export type LibraryDetailLayout = 'drawer' | 'modal';

export const LIBRARY_DETAIL_LAYOUT_OPTIONS = [
    { value: 'modal', label: 'Full screen' },
    { value: 'drawer', label: 'Side drawer' },
] as const;

export const normalizeLibraryDetailLayout = (value?: string | null): LibraryDetailLayout => (
    value === 'drawer' ? 'drawer' : 'modal'
);
export const SEARCH_SETS_PAGE_SIZE = 50;
export const SEARCH_SETS_PAGE_SIZE_STORAGE_KEY = 'posterSetsSearchPageSize.v1';
export const RECENT_SETS_PAGE_SIZE_STORAGE_KEY = 'posterSetsRecentPageSize.v1';
export const SEARCH_SETS_PAGE_SIZE_OPTIONS = [
    { value: '24', label: '24 per page' },
    { value: '50', label: '50 per page' },
    { value: '100', label: '100 per page' },
    { value: '200', label: '200 per page' },
    { value: '250', label: '250 per page' },
] as const;
export const SEARCH_SETS_PAGE_SIZE_VALUES = SEARCH_SETS_PAGE_SIZE_OPTIONS.map((option) => Number(option.value));
export const normalizeSearchSetsPageSize = (value: unknown): number => {
    const next = Number(value);
    return SEARCH_SETS_PAGE_SIZE_VALUES.includes(next) ? next : SEARCH_SETS_PAGE_SIZE;
};
export const WATCHES_PAGE_SIZE_OPTIONS = [
    { value: '12', label: '12 per page' },
    { value: '24', label: '24 per page' },
    { value: '36', label: '36 per page' },
    { value: '48', label: '48 per page' },
] as const;
export const ALL_MEDIUX_FILTER_IDS = MEDIUX_FILTER_OPTIONS.map((option) => option.id);
export const TITLE_CARD_ONLY_FILTERS = ['title_card'];

/** Survive Poster Sets remounts so Browse doesn't flash empty while the server cache answers. */
export const browseRailsCache: { rails: PosterSetsBrowseRail[] } = { rails: [] };

export const cardClass = dashboardPanelClass;
export const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs font-semibold text-text transition hover:border-plex/40 hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
export const primaryButtonClass = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-plex px-2.5 py-1.5 text-xs font-bold text-background transition hover:bg-plex-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 sm:gap-2 sm:px-3 sm:py-2 sm:text-sm';
/** Hide Chromium/Safari/Edge native clear on type=search so custom X buttons don't double up. */
export const nativeSearchCancelHiddenClass = '[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-ms-clear]:hidden';
export const fieldClass = `w-full appearance-none rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-[16px] leading-5 text-text placeholder:text-muted/60 outline-none transition focus:border-plex focus:ring-1 focus:ring-plex sm:py-2.5 ${nativeSearchCancelHiddenClass}`;
export const sectionTitleClass = 'text-base font-bold text-text sm:text-lg';
export const sectionBodyClass = 'mt-1 text-xs text-muted sm:text-sm';
export const posterMediaRadiusClass = 'rounded-md';
export const previewStripClass = 'flex w-full min-w-0 gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 touch-pan-x [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';
