import type { CSSProperties } from 'react';
import { DESKTOP_NAV_COLLAPSED_WIDTH_PX, DESKTOP_NAV_EXPANDED_WIDTH_PX } from './desktopNavCollapse';

export const activityStreamColumnCount = () => 3;

export const activityStreamGridClass = () => 'discover-activity-grid';

/** Auto-wrapping poster grid sized to the content area, not the viewport. */
export const discoverPosterGridClass = 'discover-poster-grid';

export type UpgraderGridSize = 'small' | 'medium' | 'large' | 'xlarge' | 'list';
export type PosterGridValue = UpgraderGridSize | number;

export const DEFAULT_UPGRADER_GRID_SIZE: UpgraderGridSize = 'large';
export const POSTER_GRID_SCALE_MIN = 4.5;
export const POSTER_GRID_SCALE_MAX = 18;
export const POSTER_GRID_SCALE_STEP = 0.25;
export const DEFAULT_POSTER_GRID_SCALE = 9.5;

export const POSTER_GRID_PRESET_SCALE: Record<Exclude<UpgraderGridSize, 'list'>, number> = {
    small: 5,
    medium: 7,
    large: 9.5,
    xlarge: 13,
};

/** Poster Sets historically sat one step larger than Discover/Upgrader. */
export const POSTER_SETS_GRID_PRESET_SCALE: Record<Exclude<UpgraderGridSize, 'list'>, number> = {
    small: 7,
    medium: 9.5,
    large: 13,
    xlarge: 17,
};

export const clampPosterGridScale = (value: number) => {
    const stepped = Math.round(Number(value) / POSTER_GRID_SCALE_STEP) * POSTER_GRID_SCALE_STEP;
    const clamped = Math.min(POSTER_GRID_SCALE_MAX, Math.max(POSTER_GRID_SCALE_MIN, stepped));
    return Number(clamped.toFixed(2));
};

export const posterGridScaleRem = (
    size: PosterGridValue,
    presets: Record<Exclude<UpgraderGridSize, 'list'>, number> = POSTER_GRID_PRESET_SCALE,
) => {
    if (typeof size === 'number') return clampPosterGridScale(size);
    if (size === 'list') return DEFAULT_POSTER_GRID_SCALE;
    return presets[size] ?? DEFAULT_POSTER_GRID_SCALE;
};

/** Home and Library Recommended rails share this size: 15% above the poster slider. */
export const homeRailPosterDensity = (size: PosterGridValue) => (
    posterGridScaleRem(posterGridScaleRem(size) * 1.15)
);

export const posterGridDensityBand = (size: PosterGridValue): UpgraderGridSize => {
    if (size === 'list') return 'list';
    const rem = posterGridScaleRem(size);
    if (rem < 6.25) return 'small';
    if (rem < 8.25) return 'medium';
    if (rem < 11.5) return 'large';
    return 'xlarge';
};

export const parsePosterGridValue = (
    value: unknown,
    { allowList = false, presets = POSTER_GRID_PRESET_SCALE }: {
        allowList?: boolean;
        presets?: Record<Exclude<UpgraderGridSize, 'list'>, number>;
    } = {},
): PosterGridValue => {
    if (allowList && value === 'list') return 'list';
    if (typeof value === 'number' && Number.isFinite(value)) return clampPosterGridScale(value);
    const raw = String(value ?? '').trim();
    if (allowList && raw === 'list') return 'list';
    if (raw === 'small' || raw === 'medium' || raw === 'large' || raw === 'xlarge') return presets[raw];
    const numeric = Number(raw);
    if (raw !== '' && Number.isFinite(numeric)) return clampPosterGridScale(numeric);
    return DEFAULT_POSTER_GRID_SCALE;
};

export const upgraderPosterGridClass = (size: PosterGridValue) => {
    if (size === 'list') return 'flex flex-col gap-3';
    return `upgrader-poster-grid upgrader-poster-grid--${posterGridDensityBand(size)}`;
};

/** Minimum poster column width per density preset (used with auto-fill). */
export const UPGRADER_GRID_MIN_WIDTH: Record<UpgraderGridSize, string> = {
    small: '5rem',
    medium: '7rem',
    large: '9.5rem',
    xlarge: '13rem',
    list: '100%',
};

/** Wider columns for landscape title-card packs (roughly 16:9 vs 2:3 posters). */
export const UPGRADER_LANDSCAPE_GRID_MIN_WIDTH: Record<UpgraderGridSize, string> = {
    small: '10rem',
    medium: '14rem',
    large: '18rem',
    xlarge: '22rem',
    list: '100%',
};

/** Match discover-poster-grid @container breakpoints (width in px). */
export const discoverPosterGridColumnsAtWidth = (containerWidth: number): number => {
    if (containerWidth >= 896) return 10;
    if (containerWidth >= 768) return 8;
    if (containerWidth >= 480) return 5;
    if (containerWidth >= 384) return 4;
    return 3;
};

/** Approximate main content width (sidebar-aware). */
export const estimatePortalContentWidth = (): number => {
    if (typeof window === 'undefined') return 1200;
    const zoomRaw = parseFloat(String(
        document.documentElement.style.zoom
        || getComputedStyle(document.documentElement).zoom
        || '1',
    ));
    const zoom = Number.isFinite(zoomRaw) && zoomRaw > 0 ? zoomRaw : 1;
    const visual = window.innerWidth || document.documentElement.clientWidth || 1200;
    const client = document.documentElement.clientWidth || visual;
    // Android TV zooms the root out. innerWidth stays the narrow WebView width
    // while the page lays out at about 1920 CSS pixels.
    const layout = zoom < 0.98 ? Math.max(visual, client) / zoom : Math.max(visual, client);
    const tv = document.documentElement.dataset.tv === '1';
    const isDesktop = layout >= 768;
    const iconsOnly = document.documentElement.dataset.desktopNavIcons === '1';
    const sidebar = !tv && isDesktop
        ? (iconsOnly ? DESKTOP_NAV_COLLAPSED_WIDTH_PX : DESKTOP_NAV_EXPANDED_WIDTH_PX)
        : 0;
    const padding = tv ? 48 : isDesktop ? 64 : 8;
    return Math.max(320, layout - sidebar - padding);
};

export const posterGridSkeletonCount = (rows = 2, containerWidth = estimatePortalContentWidth()): number => (
    discoverPosterGridColumnsAtWidth(containerWidth) * rows
);

export const carouselRowSkeletonCount = (containerWidth = estimatePortalContentWidth()): number => {
    const cardWidth = containerWidth >= 640 ? 160 : 140;
    return Math.max(4, Math.ceil(containerWidth / (cardWidth + 16)));
};

export const upgraderPosterGridStyle = (size: PosterGridValue): CSSProperties => {
    if (size === 'list') return {};
    const rem = posterGridScaleRem(size);
    const gap = rem < 6.25 ? 0.375 : rem < 8.25 ? 0.5 : rem < 11.5 ? 0.625 : 0.75;
    return {
        gridTemplateColumns: `repeat(auto-fill, minmax(${rem}rem, 1fr))`,
        gap: `${gap}rem`,
    };
};

export const upgraderLandscapeGridStyle = (size: PosterGridValue): CSSProperties => {
    if (size === 'list') return {};
    const rem = posterGridScaleRem(size) * 1.85;
    const gap = rem < 11.5 ? 0.5 : 0.75;
    return {
        gridTemplateColumns: `repeat(auto-fill, minmax(${rem}rem, 1fr))`,
        gap: `${gap}rem`,
    };
};

export const posterGridCardWidthStyle = (size: PosterGridValue): CSSProperties => ({
    width: `${posterGridScaleRem(size)}rem`,
});

export const posterGridImageSize = (size: PosterGridValue) => {
    if (size === 'list') return { width: 96, height: 144 };
    const width = Math.round(posterGridScaleRem(size) * 16);
    return { width, height: Math.round(width * 1.5) };
};

/** Fixed carousel poster widths for Discover home rails (mirrors Movies/Series grid density). */
export const DISCOVER_ROW_CARD_WIDTH_CLASS: Record<UpgraderGridSize, string> = {
    small: 'w-[100px] sm:w-[112px]',
    medium: 'w-[140px] sm:w-[160px]',
    large: 'w-[170px] sm:w-[196px]',
    xlarge: 'w-[204px] sm:w-[236px]',
    list: 'w-[140px] sm:w-[160px]',
};

export const discoverRowCardWidthClass = (size: PosterGridValue) => {
    if (typeof size === 'number') return '';
    return DISCOVER_ROW_CARD_WIDTH_CLASS[size] || DISCOVER_ROW_CARD_WIDTH_CLASS[DEFAULT_UPGRADER_GRID_SIZE];
};

/** Square album/artist card widths for Discover music rails. */
export const DISCOVER_MUSIC_ROW_CARD_WIDTH_CLASS: Record<UpgraderGridSize, string> = {
    small: 'w-[112px] sm:w-[128px]',
    medium: 'w-[140px] sm:w-[160px]',
    large: 'w-[168px] sm:w-[188px]',
    xlarge: 'w-[196px] sm:w-[220px]',
    list: 'w-[140px] sm:w-[160px]',
};

export const discoverMusicRowCardWidthClass = (size: PosterGridValue) => {
    if (typeof size === 'number') return '';
    return DISCOVER_MUSIC_ROW_CARD_WIDTH_CLASS[size] || DISCOVER_MUSIC_ROW_CARD_WIDTH_CLASS[DEFAULT_UPGRADER_GRID_SIZE];
};

export const UPGRADER_GRID_SIZE_STORAGE_KEY = 'upgraderGridSize.v2';

export const normalizeUpgraderGridSize = (value: unknown): UpgraderGridSize => {
    if (value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge' || value === 'list') return value;
    return posterGridDensityBand(parsePosterGridValue(value));
};
