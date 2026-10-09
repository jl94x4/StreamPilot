/** Focal-point helpers for hero/backdrop crops (face-aware when supported). */

export type FocalPoint = { x: number; y: number };

/** Upper-third bias when FaceDetector is unavailable (typical cinematic backdrops). */
const DEFAULT_FOCAL: FocalPoint = { x: 50, y: 22 };
const focalCache = new Map<string, FocalPoint>();
const inflight = new Map<string, Promise<FocalPoint>>();

type FaceDetectorLike = {
    detect: (image: ImageBitmapSource) => Promise<Array<{ boundingBox: DOMRectReadOnly }>>;
};

const getFaceDetector = (): FaceDetectorLike | null => {
    if (typeof window === 'undefined') return null;
    const Ctor = (window as any).FaceDetector;
    if (typeof Ctor !== 'function') return null;
    try {
        // Accurate mode keeps short heroes from chopping foreheads.
        return new Ctor({ fastMode: false, maxDetectedFaces: 8 });
    } catch {
        try {
            return new Ctor({ fastMode: true, maxDetectedFaces: 5 });
        } catch {
            return null;
        }
    }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const loadImageElement = (src: string, crossOrigin: boolean): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
});

const IMAGE_CACHE_CAP = 24;
const imageDecodeCache = new Map<string, HTMLImageElement>();
const imageDecodeInflight = new Map<string, Promise<HTMLImageElement>>();

const rememberDecodedImage = (key: string, img: HTMLImageElement, objectUrl?: string) => {
    if (objectUrl) {
        (img as HTMLImageElement & { __smpObjectUrl?: string }).__smpObjectUrl = objectUrl;
    }
    if (imageDecodeCache.has(key)) {
        imageDecodeCache.set(key, img);
        return;
    }
    if (imageDecodeCache.size >= IMAGE_CACHE_CAP) {
        const oldest = imageDecodeCache.keys().next().value;
        if (oldest) {
            const prev = imageDecodeCache.get(oldest);
            const stale = (prev as HTMLImageElement & { __smpObjectUrl?: string } | undefined)?.__smpObjectUrl;
            if (stale) {
                try { URL.revokeObjectURL(stale); } catch { /* ignore */ }
            }
            imageDecodeCache.delete(oldest);
        }
    }
    imageDecodeCache.set(key, img);
};

/** Decode via fetch+blob first so Capacitor/canvas sampling is not CORS-tainted. Dedupes concurrent loads. */
const loadImage = async (url: string): Promise<HTMLImageElement> => {
    const key = String(url || '').trim();
    if (!key) throw new Error('empty url');
    const cached = imageDecodeCache.get(key);
    if (cached) return cached;
    const pending = imageDecodeInflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
        try {
            const res = await fetch(key, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (!res.ok) throw new Error('fetch failed');
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            try {
                const img = await loadImageElement(objectUrl, false);
                rememberDecodedImage(key, img, objectUrl);
                return img;
            } catch (err) {
                try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
                throw err;
            }
        } catch {
            const img = await loadImageElement(key, true);
            rememberDecodedImage(key, img);
            return img;
        } finally {
            imageDecodeInflight.delete(key);
        }
    })();

    imageDecodeInflight.set(key, promise);
    return promise;
};

/**
 * Prefer eye-line of the largest / highest faces so short banners keep heads in frame.
 * Ignores tiny or outlier detections that pull the crop toward covered/extra faces.
 */
export const focalFromFaces = (
    faces: Array<{ boundingBox: DOMRectReadOnly }>,
    width: number,
    height: number,
): FocalPoint | null => {
    if (!faces.length || !width || !height) return null;

    const minArea = width * height * 0.004;
    const scored = faces
        .map((face) => {
            const box = face.boundingBox;
            const w = Math.max(1, box.width);
            const h = Math.max(1, box.height);
            const area = w * h;
            const midY = (box.y + h / 2) / height;
            // Prefer larger faces and ones higher in the frame (main subjects).
            const heightBoost = 1 + Math.max(0, 0.6 - midY) * 1.4;
            return { box, w, h, area, score: area * heightBoost };
        })
        .filter((entry) => entry.area >= minArea)
        .sort((a, b) => b.score - a.score);

    const pool = scored.length ? scored : faces.map((face) => {
        const box = face.boundingBox;
        const w = Math.max(1, box.width);
        const h = Math.max(1, box.height);
        return { box, w, h, area: w * h, score: w * h };
    }).sort((a, b) => b.score - a.score);

    // One strong face is enough; at most two so a covered second face can't drag the crop.
    const primary = pool.slice(0, Math.min(2, pool.length));
    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    let topMost = height;

    for (const { box, w, h, area } of primary) {
        // Eye-line sits ~35–40% down a face box, not at geometric center (chin-biased).
        const eyeX = box.x + w / 2;
        const eyeY = box.y + h * 0.36;
        sumX += eyeX * area;
        sumY += eyeY * area;
        topMost = Math.min(topMost, box.y);
        totalWeight += area;
    }
    if (!totalWeight) return null;

    const centerX = (sumX / totalWeight / width) * 100;
    const eyeY = (sumY / totalWeight / height) * 100;
    const topY = (topMost / height) * 100;

    // Pull above the eyes so hair/forehead survive cover crops on short heroes.
    const y = clamp(Math.min(eyeY - 12, topY + 6), 6, 32);
    return {
        x: clamp(centerX, 18, 82),
        y,
    };
};

export const formatBackgroundPosition = (focal: FocalPoint = DEFAULT_FOCAL) => (
    `${focal.x}% ${focal.y}%`
);

export type HeroFocal = FocalPoint & { imageWidth: number; imageHeight: number };

/**
 * object-position that places an image point at the center of an object-fit:cover frame.
 * Percentages alone line the point up with the same percentage of the frame, which
 * shoves faces into the top edge of a short hero.
 */
export const objectPositionForCoverCenter = (
    focal: FocalPoint,
    imageWidth: number,
    imageHeight: number,
    frameWidth: number,
    frameHeight: number,
) => {
    if (!imageWidth || !imageHeight || frameWidth < 2 || frameHeight < 2) return '50% 50%';
    const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
    const place = (ratio: number, rendered: number, frame: number) => {
        const overflow = rendered - frame;
        if (overflow <= 1) return 50;
        const p = ((ratio / 100) * rendered - frame / 2) / overflow;
        return clamp(p * 100, 0, 100);
    };
    return `${place(focal.x, imageWidth * scale, frameWidth)}% ${place(focal.y, imageHeight * scale, frameHeight)}%`;
};

const skinWeight = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (r < 70 || max < 80 || r <= g || r < b * 0.85) return 0;
    const chroma = max - min;
    if (chroma < 14) return 0;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cr = r - y;
    if (y < 45 || y > 245 || cr < 8 || cr > 85) return 0;
    return chroma;
};

/** Largest skin-toned cluster, used when the TV WebView has no FaceDetector. */
export const focalFromSkin = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
): FocalPoint | null => {
    if (!width || !height) return null;
    const cols = 16;
    const rows = 9;
    const cells = new Float32Array(cols * rows);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const weight = skinWeight(data[index], data[index + 1], data[index + 2]);
            if (!weight) continue;
            const col = Math.min(cols - 1, Math.floor((x / width) * cols));
            const row = Math.min(rows - 1, Math.floor((y / height) * rows));
            cells[row * cols + col] += weight;
        }
    }
    let best = 0;
    let bestIndex = -1;
    for (let index = 0; index < cells.length; index += 1) {
        const col = index % cols;
        const row = Math.floor(index / cols);
        let sum = cells[index];
        if (col > 0) sum += cells[index - 1] * 0.7;
        if (col < cols - 1) sum += cells[index + 1] * 0.7;
        if (row > 0) sum += cells[index - cols] * 0.7;
        if (row < rows - 1) sum += cells[index + cols] * 0.7;
        if (sum > best) {
            best = sum;
            bestIndex = index;
        }
    }
    if (bestIndex < 0 || best < 48) return null;
    const bestCol = bestIndex % cols;
    const bestRow = Math.floor(bestIndex / cols);
    let weightSum = 0;
    let xSum = 0;
    let ySum = 0;
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            if (Math.abs(col - bestCol) + Math.abs(row - bestRow) > 3) continue;
            const weight = cells[row * cols + col];
            if (!weight) continue;
            xSum += ((col + 0.5) / cols) * weight;
            ySum += ((row + 0.5) / rows) * weight;
            weightSum += weight;
        }
    }
    if (!weightSum) return null;
    return {
        x: clamp((xSum / weightSum) * 100, 8, 92),
        y: clamp((ySum / weightSum) * 100, 8, 92),
    };
};

const focalFromFacesCentered = (
    faces: Array<{ boundingBox: DOMRectReadOnly }>,
    width: number,
    height: number,
): FocalPoint | null => {
    const biased = focalFromFaces(faces, width, height);
    if (!biased || !faces.length || !width || !height) return biased;
    const minArea = width * height * 0.004;
    const ranked = faces
        .map((face) => {
            const box = face.boundingBox;
            const w = Math.max(1, box.width);
            const h = Math.max(1, box.height);
            return { box, w, h, area: w * h };
        })
        .filter((entry) => entry.area >= minArea)
        .sort((a, b) => b.area - a.area)
        .slice(0, 2);
    const pool = ranked.length ? ranked : faces.slice(0, 1).map((face) => {
        const box = face.boundingBox;
        const w = Math.max(1, box.width);
        const h = Math.max(1, box.height);
        return { box, w, h, area: w * h };
    });
    let weight = 0;
    let xSum = 0;
    let ySum = 0;
    for (const { box, w, h, area } of pool) {
        xSum += (box.x + w / 2) * area;
        ySum += (box.y + h * 0.42) * area;
        weight += area;
    }
    if (!weight) return biased;
    return {
        x: clamp((xSum / weight / width) * 100, 8, 92),
        y: clamp((ySum / weight / height) * 100, 8, 92),
    };
};

const heroFocalCache = new Map<string, HeroFocal>();
const heroFocalInflight = new Map<string, Promise<HeroFocal>>();

/** Face (or skin-cluster) point in the backdrop, for centering inside the hero crop. */
export const resolveHeroFocalPoint = async (url: string): Promise<HeroFocal> => {
    const key = String(url || '').trim();
    const empty: HeroFocal = { x: 50, y: 50, imageWidth: 0, imageHeight: 0 };
    if (!key) return empty;
    const cached = heroFocalCache.get(key);
    if (cached) return cached;
    const pending = heroFocalInflight.get(key);
    if (pending) return pending;

    const task = (async () => {
        let focal: HeroFocal = empty;
        try {
            const img = await loadImage(key);
            const imageWidth = img.naturalWidth || img.width;
            const imageHeight = img.naturalHeight || img.height;
            let point: FocalPoint | null = null;
            const detector = getFaceDetector();
            if (detector) {
                const faces = await detector.detect(img);
                point = focalFromFacesCentered(faces, imageWidth, imageHeight);
            }
            if (!point && imageWidth && imageHeight) {
                const sampleW = 96;
                const sampleH = Math.max(24, Math.round(sampleW * (imageHeight / imageWidth)));
                const canvas = document.createElement('canvas');
                canvas.width = sampleW;
                canvas.height = sampleH;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                    ctx.drawImage(img, 0, 0, sampleW, sampleH);
                    point = focalFromSkin(ctx.getImageData(0, 0, sampleW, sampleH).data, sampleW, sampleH);
                }
            }
            focal = {
                x: point?.x ?? 50,
                y: point?.y ?? 50,
                imageWidth,
                imageHeight,
            };
        } catch {
            focal = empty;
        }
        heroFocalCache.set(key, focal);
        heroFocalInflight.delete(key);
        return focal;
    })();

    heroFocalInflight.set(key, task);
    return task;
};

export const prefetchHeroFocalPoints = (urls: string[]) => {
    urls.forEach((url) => {
        if (url && !heroFocalCache.has(url) && !heroFocalInflight.has(url)) {
            void resolveHeroFocalPoint(url);
        }
    });
};

/** Home hero: bias faces into the right half so left-side copy stays clear of subjects. */
export const formatHomeHeroBackdropPosition = (focal: FocalPoint = DEFAULT_FOCAL) => {
    const x = focal.x < 48
        ? clamp(focal.x + 22, 54, 78)
        : clamp(focal.x + 8, 52, 80);
    const y = clamp(focal.y, 18, 44);
    return `${x}% ${y}%`;
};

/** TV title pages: keep faces in the art column beside the poster (not under it). */
export const formatTvDetailsBackdropPosition = (focal: FocalPoint = DEFAULT_FOCAL) => {
    const x = focal.x < 44 ? clamp(focal.x + 14, 52, 88) : clamp(focal.x + 3, 40, 88);
    const y = clamp(focal.y, 10, 34);
    return `${x}% ${y}%`;
};

/** Web title pages: show the widescreen frame. A short cover-crop on the face turns stills into head shots. */
export const formatWebDetailsBackdropPosition = (focal: FocalPoint = DEFAULT_FOCAL) => {
    const x = clamp(focal.x, 46, 54);
    const y = clamp(44 + Math.round((focal.y - 18) * 0.15), 42, 50);
    return `${x}% ${y}%`;
};

/**
 * Resolve a background-position focal point for an image URL.
 * Uses FaceDetector when available; otherwise biases toward the upper third
 * (typical for cinematic backdrops).
 */
export const resolveImageFocalPoint = async (url: string): Promise<FocalPoint> => {
    const key = String(url || '').trim();
    if (!key) return DEFAULT_FOCAL;

    const cached = focalCache.get(key);
    if (cached) return cached;

    const pending = inflight.get(key);
    if (pending) return pending;

    const task = (async () => {
        let focal = DEFAULT_FOCAL;
        try {
            const detector = getFaceDetector();
            if (detector) {
                const img = await loadImage(key);
                const faces = await detector.detect(img);
                const detected = focalFromFaces(faces, img.naturalWidth || img.width, img.naturalHeight || img.height);
                if (detected) focal = detected;
            }
        } catch {
            // CORS / unsupported / detection failure → keep default upper bias
        }
        focalCache.set(key, focal);
        inflight.delete(key);
        return focal;
    })();

    inflight.set(key, task);
    return task;
};

export const prefetchImageFocalPoints = (urls: string[]) => {
    urls.forEach((url) => {
        if (url && !focalCache.has(url) && !inflight.has(url)) {
            void resolveImageFocalPoint(url);
        }
    });
};

const surfaceCache = new Map<string, string>();
const surfaceInflight = new Map<string, Promise<string | null>>();

/** Space-separated R G B for CSS `rgb(var(--token))` (e.g. `38 41 48`). */
export const DEFAULT_BACKDROP_SURFACE_RGB = '38 41 48';

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clampByte = (value: number) => Math.min(255, Math.max(0, value));
/** Keep overview chrome in the dark range — never a light/white page (Toy Story). */
const MAX_SURFACE_LUMA = 82;
const TARGET_POSTER_SURFACE_LUMA = 54;

/**
 * Dominant poster colour as a dark page surface: weight chromatic pixels,
 * skip near-black/white, then darken while keeping hue (no mix toward gray).
 */
export const posterSurfaceFromRgba = (data: Uint8ClampedArray | Uint8Array): string | null => {
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let wSum = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 20) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const y = luma(r, g, b);
        if (y < 14 || y > 212) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;
        if (chroma < 10 && y < 48) continue;
        const sat = max === 0 ? 0 : chroma / max;
        const weight = 0.4 + sat * 2 + chroma / 160;
        rSum += r * weight;
        gSum += g * weight;
        bSum += b * weight;
        wSum += weight;
    }
    if (wSum < 1) return null;

    let r = rSum / wSum;
    let g = gSum / wSum;
    let b = bSum / wSum;
    const avg = (r + g + b) / 3;
    r = clampByte(avg + (r - avg) * 1.38);
    g = clampByte(avg + (g - avg) * 1.38);
    b = clampByte(avg + (b - avg) * 1.38);

    const y = luma(r, g, b);
    if (y > TARGET_POSTER_SURFACE_LUMA && y > 0) {
        const scale = TARGET_POSTER_SURFACE_LUMA / y;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    const y2 = luma(r, g, b);
    if (y2 > MAX_SURFACE_LUMA && y2 > 0) {
        const scale = MAX_SURFACE_LUMA / y2;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    return [Math.round(r), Math.round(g), Math.round(b)].join(' ');
};

const parsePositionPercent = (position = '50% 50%') => {
    const [xRaw, yRaw] = String(position).trim().split(/\s+/);
    const read = (raw: string | undefined, fallback: number) => {
        const value = parseFloat(String(raw ?? ''));
        return Number.isFinite(value) ? value / 100 : fallback;
    };
    return { x: read(xRaw, 0.5), y: read(yRaw, 0.5) };
};

const surfaceFromAverage = (r: number, g: number, b: number) => {
    const y = luma(r, g, b);
    if (y > MAX_SURFACE_LUMA && y > 0) {
        const scale = MAX_SURFACE_LUMA / y;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    return [Math.round(r), Math.round(g), Math.round(b)].join(' ');
};

/**
 * Average the bottom edge of a backdrop so the page surface matches the art.
 * Pass the on-screen frame to sample the pixels actually at the bottom of the crop.
 * Returns null when CORS or canvas read fails.
 */
export const sampleBackdropSurfaceColor = async (
    url: string,
    frame?: { width: number; height: number; position?: string },
): Promise<string | null> => {
    const key = [
        String(url || '').trim(),
        frame ? `${Math.round(frame.width)}x${Math.round(frame.height)}` : 'file-edge',
        frame?.position || '',
    ].join('|');
    if (key.startsWith('|')) return null;
    const cached = surfaceCache.get(key);
    if (cached) return cached;

    try {
        const img = await loadImage(key.split('|')[0]);
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        if (!sw || !sh) return null;

        let sx = 0;
        let sWidth = sw;
        let sHeight = Math.max(2, Math.min(18, Math.round(sh * 0.025)));
        let sy = sh - sHeight;
        if (frame && frame.width > 2 && frame.height > 2) {
            const pos = parsePositionPercent(frame.position);
            const scale = Math.max(frame.width / sw, frame.height / sh);
            const renderedW = sw * scale;
            const renderedH = sh * scale;
            const offsetX = (frame.width - renderedW) * pos.x;
            const offsetY = (frame.height - renderedH) * pos.y;
            const viewLeft = Math.max(0, Math.min(sw - 1, -offsetX / scale));
            const viewTop = Math.max(0, Math.min(sh - 1, -offsetY / scale));
            const viewWidth = Math.max(1, Math.min(sw - viewLeft, frame.width / scale));
            const viewHeight = Math.max(1, Math.min(sh - viewTop, frame.height / scale));
            sHeight = Math.max(2, Math.min(16, viewHeight * 0.04));
            sx = viewLeft;
            sWidth = viewWidth;
            sy = Math.max(0, Math.min(sh - sHeight, viewTop + viewHeight - sHeight));
        }

        const canvas = document.createElement('canvas');
        const tw = 96;
        const th = 8;
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, tw, th);

        const { data } = ctx.getImageData(0, 0, tw, th);
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 20) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count += 1;
        }
        if (!count) return null;
        const rgb = surfaceFromAverage(r / count, g / count, b / count);
        surfaceCache.set(key, rgb);
        return rgb;
    } catch {
        return null;
    }
};

/** Bright edges (white wardrobe, pale skies) otherwise paint a glowing slab. */
const toneHeroEdgeColor = (r: number, g: number, b: number) => {
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cap = 132;
    if (y > cap && y > 0) {
        const scale = cap / y;
        r *= scale;
        g *= scale;
        b *= scale;
        y = cap;
    }
    if (y > 110) {
        const mix = Math.min(1, (y - 110) / 50) * 0.45;
        r = r * (1 - mix) + 36 * mix;
        g = g * (1 - mix) + 40 * mix;
        b = b * (1 - mix) + 48 * mix;
    }
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
};

/**
 * Average the left edge of a cover-cropped backdrop so the hero's empty side
 * matches the pixels the fade dissolves into. Returns a top-to-bottom CSS
 * gradient. Null when the image cannot be read.
 */
export const sampleBackdropLeftEdgeFill = async (
    url: string,
    frame?: { width: number; height: number; position?: string },
): Promise<string | null> => {
    const key = [
        'left-v2',
        String(url || '').trim(),
        frame ? `${Math.round(frame.width)}x${Math.round(frame.height)}` : 'file-edge',
        frame?.position || '',
    ].join('|');
    if (key.startsWith('left-v2||')) return null;
    const cached = surfaceCache.get(key);
    if (cached) return cached;
    const pending = surfaceInflight.get(key);
    if (pending) return pending;

    const work = (async (): Promise<string | null> => {
        try {
            const img = await loadImage(key.split('|')[1]);
            const sw = img.naturalWidth || img.width;
            const sh = img.naturalHeight || img.height;
            if (!sw || !sh) return null;

            let sx = 0;
            let sy = 0;
            let sWidth = Math.max(2, Math.min(24, Math.round(sw * 0.04)));
            let sHeight = sh;
            if (frame && frame.width > 2 && frame.height > 2) {
                const pos = parsePositionPercent(frame.position);
                const scale = Math.max(frame.width / sw, frame.height / sh);
                const renderedW = sw * scale;
                const renderedH = sh * scale;
                const offsetX = (frame.width - renderedW) * pos.x;
                const offsetY = (frame.height - renderedH) * pos.y;
                const viewLeft = Math.max(0, Math.min(sw - 1, -offsetX / scale));
                const viewTop = Math.max(0, Math.min(sh - 1, -offsetY / scale));
                const viewWidth = Math.max(1, Math.min(sw - viewLeft, frame.width / scale));
                const viewHeight = Math.max(1, Math.min(sh - viewTop, frame.height / scale));
                sx = viewLeft;
                sy = viewTop;
                sWidth = Math.max(2, Math.min(viewWidth, Math.max(2, viewWidth * 0.045)));
                sHeight = viewHeight;
            }

            const canvas = document.createElement('canvas');
            const tw = 6;
            const th = 36;
            canvas.width = tw;
            canvas.height = th;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return null;
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, tw, th);
            const { data } = ctx.getImageData(0, 0, tw, th);
            const band = (fromRow: number, toRow: number) => {
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;
                for (let y = fromRow; y < toRow; y += 1) {
                    for (let x = 0; x < tw; x += 1) {
                        const i = (y * tw + x) * 4;
                        if (data[i + 3] < 20) continue;
                        r += data[i];
                        g += data[i + 1];
                        b += data[i + 2];
                        count += 1;
                    }
                }
                if (!count) return null;
                return toneHeroEdgeColor(r / count, g / count, b / count);
            };
            const top = band(0, 12);
            const mid = band(12, 24);
            const bottom = band(24, 36);
            if (!top || !mid || !bottom) return null;
            const fill = `linear-gradient(to bottom, ${top} 0%, ${mid} 48%, ${bottom} 100%)`;
            surfaceCache.set(key, fill);
            return fill;
        } catch {
            return null;
        } finally {
            surfaceInflight.delete(key);
        }
    })();

    surfaceInflight.set(key, work);
    return work;
};

/** Sample a poster (or any still) for the details page surface colour. */
export const samplePosterSurfaceColor = async (url: string): Promise<string | null> => {
    const key = `poster:${String(url || '').trim()}`;
    if (key === 'poster:') return null;
    const cached = surfaceCache.get(key);
    if (cached) return cached;

    try {
        const img = await loadImage(url);
        const sw = img.naturalWidth || img.width;
        const sh = img.naturalHeight || img.height;
        if (!sw || !sh) return null;

        const canvas = document.createElement('canvas');
        const tw = 32;
        const th = 48;
        canvas.width = tw;
        canvas.height = th;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, tw, th);
        const rgb = posterSurfaceFromRgba(ctx.getImageData(0, 0, tw, th).data);
        if (!rgb) return null;
        surfaceCache.set(key, rgb);
        return rgb;
    } catch {
        return null;
    }
};
