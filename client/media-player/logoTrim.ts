/** Detect transparent padding on clear-logo PNGs so we can sit them flush with the poster. */

export type LogoInsets = {
    left: number;
    top: number;
    /** Empty space on the right / bottom (older cached entries may lack them). */
    right?: number;
    bottom?: number;
};

const ALPHA = 20;
const BLACK = 18;
const MAX_LEFT = 0.42;
const MAX_TOP = 0.28;
const SAMPLE_WIDTH = 320;
const inflight = new Map<string, Promise<LogoInsets>>();
const NONE: LogoInsets = { left: 0, top: 0 };

/**
 * Measured insets are kept across launches. A logo stays hidden until it is measured, so
 * with an in-memory cache only, every logo popped in late after each app start (a fetch
 * plus a canvas scan per title on a slow TV). Keys drop sign-in tokens: portal ones renew.
 */
const STORE_KEY = 'smp-logo-insets-v1';
const STORE_MAX = 600;
const cacheKey = (url: string) => {
    const value = String(url || '');
    if (!/[?&](access_token|X-Plex-Token)=/i.test(value)) return value;
    try {
        const parsed = new URL(value, 'https://local.invalid');
        parsed.searchParams.delete('access_token');
        parsed.searchParams.delete('X-Plex-Token');
        return parsed.toString();
    } catch {
        return value;
    }
};
const round = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : undefined);
const store = (() => {
    const map = new Map<string, LogoInsets>();
    try {
        const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as Array<[string, number, number, number?, number?]>;
        if (Array.isArray(raw)) {
            for (const row of raw) {
                if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
                map.set(row[0], { left: Number(row[1]) || 0, top: Number(row[2]) || 0, right: row[3], bottom: row[4] });
            }
        }
    } catch {
        /* storage unavailable or corrupt: start empty */
    }
    return map;
})();
let saveTimer = 0;
const saveSoon = () => {
    if (saveTimer || typeof window === 'undefined') return;
    saveTimer = window.setTimeout(() => {
        saveTimer = 0;
        try {
            const rows = Array.from(store.entries()).slice(-STORE_MAX)
                .map(([key, v]) => [key, round(v.left), round(v.top), round(v.right), round(v.bottom)]);
            localStorage.setItem(STORE_KEY, JSON.stringify(rows));
        } catch {
            /* quota or storage unavailable */
        }
    }, 4000);
};
const cache = {
    get: (url: string) => store.get(cacheKey(url)),
    set: (url: string, insets: LogoInsets) => {
        const key = cacheKey(url);
        store.delete(key);
        store.set(key, insets);
        while (store.size > STORE_MAX) {
            const oldest = store.keys().next().value;
            if (oldest === undefined) break;
            store.delete(oldest);
        }
        saveSoon();
    },
};

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

const rightOpaqueInset = (data: Uint8ClampedArray | Uint8Array, width: number, height: number): number => {
    if (!width || !height || data.length < width * height * 4) return 0;
    const need = hitsNeeded(height);
    for (let x = width - 1; x >= 0; x -= 1) {
        let hits = 0;
        for (let y = 0; y < height; y += 1) {
            if (pixelIsContent(data, (y * width + x) * 4)) {
                hits += 1;
                if (hits >= need) return clamp((width - 1 - x) / width, MAX_LEFT);
            }
        }
    }
    return 0;
};

const bottomOpaqueInset = (data: Uint8ClampedArray | Uint8Array, width: number, height: number): number => {
    if (!width || !height || data.length < width * height * 4) return 0;
    const need = hitsNeeded(width);
    for (let y = height - 1; y >= 0; y -= 1) {
        let hits = 0;
        for (let x = 0; x < width; x += 1) {
            if (pixelIsContent(data, (y * width + x) * 4)) {
                hits += 1;
                if (hits >= need) return clamp((height - 1 - y) / height, MAX_LEFT);
            }
        }
    }
    return 0;
};

const insetsFromRgba = (data: Uint8ClampedArray | Uint8Array, width: number, height: number): LogoInsets => ({
    left: leftOpaqueInset(data, width, height),
    top: topOpaqueInset(data, width, height),
    right: rightOpaqueInset(data, width, height),
    bottom: bottomOpaqueInset(data, width, height),
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
/** Most recently used composed logos kept; older blobs are released. */
const COMPOSED_CAP = 80;

const rememberComposed = (url: string, composed: ComposedLogo | null) => {
    composedCache.delete(url);
    composedCache.set(url, composed);
    while (composedCache.size > COMPOSED_CAP) {
        const oldest = composedCache.keys().next().value as string;
        const stale = composedCache.get(oldest);
        composedCache.delete(oldest);
        if (stale) URL.revokeObjectURL(stale.url);
    }
};
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
    if (composedCache.has(url)) {
        const hit = composedCache.get(url) || null;
        rememberComposed(url, hit);
        return Promise.resolve(hit);
    }
    const pending = composedInflight.get(url);
    if (pending) return pending;
    const next = composeFromUrl(url)
        .then((composed) => {
            rememberComposed(url, composed);
            composedInflight.delete(url);
            return composed;
        })
        .catch(() => {
            composedInflight.delete(url);
            rememberComposed(url, null);
            return null;
        });
    composedInflight.set(url, next);
    return next;
};

export const peekComposedLogo = (url: string): ComposedLogo | null | undefined => {
    if (!composedCache.has(url)) return undefined;
    const hit = composedCache.get(url) ?? null;
    // A logo being drawn counts as used, so it is never the one released.
    rememberComposed(url, hit);
    return hit;
};
