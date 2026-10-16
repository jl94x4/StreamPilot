export const PREVIEW_THUMB_SCALE_STORAGE_KEY = 'posterSetsPreviewThumbScale.v1';
export const PREVIEW_THUMB_SCALE_EVENT = 'poster-sets-thumb-scale';
export const PREVIEW_THUMB_SCALE_MIN = 80;
export const PREVIEW_THUMB_SCALE_MAX = 220;
export const PREVIEW_THUMB_SCALE_DEFAULT = 140;
export const PREVIEW_THUMB_POSTER_BASE_PX = 128;
export const PREVIEW_THUMB_LANDSCAPE_BASE_PX = 256;

export function clampPreviewThumbScale(value: unknown): number {
    const next = Number(value);
    if (!Number.isFinite(next)) return PREVIEW_THUMB_SCALE_DEFAULT;
    return Math.min(PREVIEW_THUMB_SCALE_MAX, Math.max(PREVIEW_THUMB_SCALE_MIN, Math.round(next)));
}

export function readPreviewThumbScale(): number {
    if (typeof window === 'undefined') return PREVIEW_THUMB_SCALE_DEFAULT;
    try {
        return clampPreviewThumbScale(window.localStorage.getItem(PREVIEW_THUMB_SCALE_STORAGE_KEY));
    } catch {
        return PREVIEW_THUMB_SCALE_DEFAULT;
    }
}

export function writePreviewThumbScale(value: number): number {
    const next = clampPreviewThumbScale(value);
    if (typeof window === 'undefined') return next;
    try {
        window.localStorage.setItem(PREVIEW_THUMB_SCALE_STORAGE_KEY, String(next));
    } catch {
        /* ignore quota / private mode */
    }
    window.dispatchEvent(new CustomEvent(PREVIEW_THUMB_SCALE_EVENT, { detail: next }));
    return next;
}

export function previewThumbWidthPx(layout: 'poster' | 'landscape', scale: number): number {
    const base = layout === 'landscape' ? PREVIEW_THUMB_LANDSCAPE_BASE_PX : PREVIEW_THUMB_POSTER_BASE_PX;
    return Math.round(base * (clampPreviewThumbScale(scale) / 100));
}
