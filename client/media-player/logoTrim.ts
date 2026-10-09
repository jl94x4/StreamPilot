/** Detect transparent padding on clear-logo PNGs so we can sit them flush with the poster. */

export type LogoInsets = {
    left: number;
    top: number;
};

const ALPHA = 20;
const BLACK = 18;
const MAX_LEFT = 0.42;
const MAX_TOP = 0.28;
const SAMPLE_WIDTH = 320;
const cache = new Map<string, LogoInsets>();
const inflight = new Map<string, Promise<LogoInsets>>();
const NONE: LogoInsets = { left: 0, top: 0 };

const clamp = (value: number, max: number) => {
    if (!Number.isFinite(value) || value <= 0.012) return 0;
    return Math.min(max, value);
};

/** Column/row needs a few content pixels so a single stray speckle does not stop the trim. */
const hitsNeeded = (size: number) => Math.max(2, Math.ceil(size * 0.02));

/** Transparent or letterbox-black counts as padding; white logos stay content. */
export const isLogoContentPixel = (r: number, g: number, b: number, a: number, alpha = ALPHA) => {
    if (a <= alpha) return false;
    return Math.max(r, g, b) > BLACK;
};

const pixelIsContent = (data: Uint8ClampedArray | Uint8Array, index: number) => (
    isLogoContentPixel(data[index], data[index + 1], data[index + 2], data[index + 3])
);

export const leftOpaqueInset = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
): number => {
    if (!width || !height || data.length < width * height * 4) return 0;
    const need = hitsNeeded(height);
    for (let x = 0; x < width; x += 1) {
        let hits = 0;
        for (let y = 0; y < height; y += 1) {
            if (pixelIsContent(data, (y * width + x) * 4)) {
                hits += 1;
                if (hits >= need) return clamp(x / width, MAX_LEFT);
            }
        }
    }
    return 0;
};

export const topOpaqueInset = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
): number => {
    if (!width || !height || data.length < width * height * 4) return 0;
    const need = hitsNeeded(width);
    for (let y = 0; y < height; y += 1) {
        let hits = 0;
        for (let x = 0; x < width; x += 1) {
            if (pixelIsContent(data, (y * width + x) * 4)) {
                hits += 1;
                if (hits >= need) return clamp(y / height, MAX_TOP);
            }
        }
    }
    return 0;
};

const insetsFromRgba = (data: Uint8ClampedArray | Uint8Array, width: number, height: number): LogoInsets => ({
    left: leftOpaqueInset(data, width, height),
    top: topOpaqueInset(data, width, height),
});

export const peekLogoInsets = (url: string): LogoInsets | null => cache.get(url) || null;

const loadImage = (url: string, crossOrigin?: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Logo load failed'));
    img.src = url;
});

const readInsetsFromSource = (source: CanvasImageSource, naturalWidth: number, naturalHeight: number): LogoInsets => {
    const scale = Math.min(1, SAMPLE_WIDTH / Math.max(1, naturalWidth));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return NONE;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return insetsFromRgba(ctx.getImageData(0, 0, width, height).data, width, height);
};

const measureFromUrl = async (url: string): Promise<LogoInsets> => {
    if (typeof document === 'undefined') return NONE;
    try {
        const res = await fetch(url, { credentials: 'include', mode: 'cors' });
        if (!res.ok) throw new Error(`Logo fetch ${res.status}`);
        const blob = await res.blob();
        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(blob);
            try {
                return readInsetsFromSource(bitmap, bitmap.width, bitmap.height);
            } finally {
                bitmap.close();
            }
        }
        const objectUrl = URL.createObjectURL(blob);
        try {
            const img = await loadImage(objectUrl);
            return readInsetsFromSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    } catch {
        try {
            const img = await loadImage(url, 'anonymous');
            return readInsetsFromSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        } catch {
            return NONE;
        }
    }
};

export const measureLogoInsets = (url: string): Promise<LogoInsets> => {
    if (!url) return Promise.resolve(NONE);
    const hit = cache.get(url);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(url);
    if (pending) return pending;
    const next = measureFromUrl(url)
        .then((insets) => {
            cache.set(url, insets);
            inflight.delete(url);
            return insets;
        })
        .catch(() => {
            inflight.delete(url);
            return NONE;
        });
    inflight.set(url, next);
    return next;
};

/** A small wordmark stacked above the title, with a clear gap between them. */
export type StudioMark = {
    markTop: number;
    markBottom: number;
    markLeft: number;
    markRight: number;
    titleTop: number;
};

const rowIsContent = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    y: number,
    need: number,
) => {
    let hits = 0;
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
        if (pixelIsContent(data, row + x * 4)) {
            hits += 1;
            if (hits >= need) return true;
        }
    }
    return false;
};

const contentBands = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
) => {
    const need = Math.max(2, Math.ceil(width * 0.008));
    const mergeGap = Math.max(2, Math.round(height * 0.02));
    const bands: Array<{ start: number; end: number }> = [];
    let start = -1;
    for (let y = 0; y <= height; y += 1) {
        const on = y < height && rowIsContent(data, width, y, need);
        if (on && start < 0) start = y;
        if (!on && start >= 0) {
            const prev = bands[bands.length - 1];
            if (prev && start - prev.end <= mergeGap) prev.end = y;
            else bands.push({ start, end: y });
            start = -1;
        }
    }
    return bands.filter((band) => band.end - band.start >= 2);
};

const horizontalSpan = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    y0: number,
    y1: number,
) => {
    const need = Math.max(1, Math.ceil((y1 - y0) * 0.08));
    let left = width;
    let right = -1;
    for (let x = 0; x < width; x += 1) {
        let hits = 0;
        for (let y = y0; y < y1; y += 1) {
            if (pixelIsContent(data, (y * width + x) * 4)) {
                hits += 1;
                if (hits >= need) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    break;
                }
            }
        }
    }
    if (right < left) return null;
    return { left: left / width, right: (right + 1) / width };
};

/**
 * Clear logos often stack a small studio script above the title.
 * Returns that top mark when a transparent gap separates it from a wider title.
 */
export const findStudioMark = (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
): StudioMark | null => {
    if (!width || !height || data.length < width * height * 4) return null;
    const bands = contentBands(data, width, height);
    if (bands.length < 2) return null;
    const mark = bands[0];
    const title = { start: bands[1].start, end: bands[bands.length - 1].end };
    const gap = title.start - mark.end;
    const markHeight = mark.end - mark.start;
    const titleHeight = title.end - title.start;
    if (gap < height * 0.028) return null;
    if (markHeight < height * 0.03 || markHeight > height * 0.4) return null;
    if (mark.end > height * 0.62) return null;
    if (titleHeight <= 0 || markHeight / titleHeight > 0.7) return null;
    const markSpan = horizontalSpan(data, width, mark.start, mark.end);
    const titleSpan = horizontalSpan(data, width, title.start, title.end);
    if (!markSpan || !titleSpan) return null;
    const markWidth = markSpan.right - markSpan.left;
    const titleWidth = titleSpan.right - titleSpan.left;
    if (titleWidth <= 0 || markWidth / titleWidth > 0.8) return null;
    return {
        markTop: mark.start / height,
        markBottom: mark.end / height,
        markLeft: markSpan.left,
        markRight: markSpan.right,
        titleTop: title.start / height,
    };
};

export type ComposedLogo = {
    url: string;
    insets: LogoInsets;
};

const STUDIO_BOOST = 1.45;
const composedCache = new Map<string, ComposedLogo | null>();
const composedInflight = new Map<string, Promise<ComposedLogo | null>>();

const readLogoRaster = (source: CanvasImageSource, naturalWidth: number, naturalHeight: number) => {
    const maxEdge = 960;
    const scale = Math.min(1, maxEdge / Math.max(naturalWidth, naturalHeight, 1));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return {
        canvas,
        ctx,
        data: ctx.getImageData(0, 0, width, height).data,
        width,
        height,
    };
};

const composeFromRaster = async (
    raster: NonNullable<ReturnType<typeof readLogoRaster>>,
): Promise<ComposedLogo | null> => {
    const { canvas, data, width, height } = raster;
    const mark = findStudioMark(data, width, height);
    if (!mark) return null;
    const markW = (mark.markRight - mark.markLeft) * width;
    const markH = (mark.markBottom - mark.markTop) * height;
    if (markW < 2 || markH < 2) return null;
    let boost = STUDIO_BOOST;
    if (markW * boost > width * 0.96) boost = (width * 0.96) / markW;
    if (boost < 1.12) return null;
    const scaledW = markW * boost;
    const scaledH = markH * boost;
    const extra = scaledH - markH;
    const srcY = Math.round(mark.markTop * height);
    const srcX = Math.round(mark.markLeft * width);
    const srcW = Math.max(1, Math.round(markW));
    const srcH = Math.max(1, Math.round(markH));
    const copyFrom = Math.round(mark.markBottom * height);
    const shift = Math.round(extra);
    const outH = height + shift;
    const snapshot = document.createElement('canvas');
    snapshot.width = width;
    snapshot.height = height;
    const snapCtx = snapshot.getContext('2d');
    if (!snapCtx) return null;
    snapCtx.drawImage(canvas, 0, 0);
    canvas.height = outH;
    const outCtx = canvas.getContext('2d');
    if (!outCtx) return null;
    outCtx.clearRect(0, 0, width, outH);
    if (srcY > 0) outCtx.drawImage(snapshot, 0, 0, width, srcY, 0, 0, width, srcY);
    const lowerH = height - copyFrom;
    if (lowerH > 0) {
        outCtx.drawImage(snapshot, 0, copyFrom, width, lowerH, 0, copyFrom + shift, width, lowerH);
    }
    let destX = srcX - (scaledW - markW) / 2;
    destX = Math.max(0, Math.min(destX, width - scaledW));
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(snapshot, srcX, srcY, srcW, srcH, destX, srcY, scaledW, scaledH);
    const next = outCtx.getImageData(0, 0, width, outH).data;
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((file) => resolve(file), 'image/png');
    });
    if (!blob) return null;
    return {
        url: URL.createObjectURL(blob),
        insets: insetsFromRgba(next, width, outH),
    };
};

const composeFromSource = async (
    source: CanvasImageSource,
    naturalWidth: number,
    naturalHeight: number,
): Promise<ComposedLogo | null> => {
    const raster = readLogoRaster(source, naturalWidth, naturalHeight);
    if (!raster) return null;
    return composeFromRaster(raster);
};

const composeFromUrl = async (url: string): Promise<ComposedLogo | null> => {
    if (typeof document === 'undefined') return null;
    try {
        const res = await fetch(url, { credentials: 'include', mode: 'cors' });
        if (!res.ok) throw new Error(`Logo fetch ${res.status}`);
        const blob = await res.blob();
        if (typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(blob);
            try {
                return await composeFromSource(bitmap, bitmap.width, bitmap.height);
            } finally {
                bitmap.close();
            }
        }
        const objectUrl = URL.createObjectURL(blob);
        try {
            const img = await loadImage(objectUrl);
            return await composeFromSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    } catch {
        try {
            const img = await loadImage(url, 'anonymous');
            return await composeFromSource(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
        } catch {
            return null;
        }
    }
};

/** Redraw a stacked studio mark slightly larger and shift the title down to keep the gap. */
export const composeBoostedStudioLogo = (url: string): Promise<ComposedLogo | null> => {
    if (!url || typeof document === 'undefined') return Promise.resolve(null);
    if (composedCache.has(url)) return Promise.resolve(composedCache.get(url) || null);
    const pending = composedInflight.get(url);
    if (pending) return pending;
    const next = composeFromUrl(url)
        .then((composed) => {
            composedCache.set(url, composed);
            composedInflight.delete(url);
            return composed;
        })
        .catch(() => {
            composedInflight.delete(url);
            composedCache.set(url, null);
            return null;
        });
    composedInflight.set(url, next);
    return next;
};

export const peekComposedLogo = (url: string): ComposedLogo | null | undefined => (
    composedCache.has(url) ? composedCache.get(url) : undefined
);
