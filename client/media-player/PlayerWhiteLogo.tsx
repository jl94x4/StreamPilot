import React, { useEffect, useState } from 'react';
import { discoveryLogoUrl } from './host';

/**
 * White version of a studio / network logo for coloured tiles.
 *
 * A CSS brightness(0) invert(1) filter whitens every opaque pixel, so logos with a solid
 * background become a white box and filled badges (DC) a white disc. Recolour on a
 * canvas (see whiten): drop solid backgrounds, cut lettering out of badges, and keep plain
 * logos as a white silhouette.
 */

const MAX_WIDTH = 360;
const cache = new Map<string, string | null>();
const waiting = new Map<string, Array<(url: string | null) => void>>();
const ready: Array<{ src: string; img: HTMLImageElement | null }> = [];
let busy = false;

type Rgb = [number, number, number];

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const colourDistance = (r: number, g: number, b: number, ref: Rgb) => (
    Math.sqrt((r - ref[0]) ** 2 + (g - ref[1]) ** 2 + (b - ref[2]) ** 2) / 441.7
);
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * - drop: solid background (or a light badge) — that colour goes transparent, the mark turns white.
 * - cutout: dark / coloured badge (DC) — the badge turns white, lighter lettering is cut out.
 * - highlights: gradient badge with no main colour — only its brightest parts stay.
 * - droplight: black-and-white artwork (Sony) — the black is the mark, the white goes.
 * - plain: ordinary transparent logo — a white silhouette.
 */
const whiten = (img: HTMLImageElement): HTMLCanvasElement | null => {
    const scale = Math.min(1, MAX_WIDTH / Math.max(1, img.naturalWidth));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const source = ctx.getImageData(0, 0, w, h);
    const src = source.data;

    let clear = 0, solid = 0, dark = 0, light = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
    const lumas: number[] = [];
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const i = (y * w + x) * 4;
            if (src[i + 3] < 40) clear += 1;
            if (src[i + 3] < 160) continue;
            solid += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            const l = luma(src[i], src[i + 1], src[i + 2]);
            if (l < 0.15) dark += 1;
            else if (l > 0.85) light += 1;
            if ((solid & 3) === 0) lumas.push(l);
            const key = ((src[i] >> 4) << 8) | ((src[i + 1] >> 4) << 4) | (src[i + 2] >> 4);
            const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
            bin.n += 1;
            bin.r += src[i];
            bin.g += src[i + 1];
            bin.b += src[i + 2];
            bins.set(key, bin);
        }
    }

    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
        const i = (y * w + x) * 4;
        return [src[i], src[i + 1], src[i + 2], src[i + 3]];
    });
    let ref: Rgb = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 4) as Rgb;
    const box = maxX >= minX ? (maxX - minX + 1) * (maxY - minY + 1) : 0;
    let mode: 'plain' | 'drop' | 'cutout' | 'highlights' | 'droplight' = 'plain';
    let lo = 0;
    let hi = 1;
    // A real background fills the corners in one colour and leaves no transparency of its own
    // (20th Century's frame reaches the corners but the logo is still cut out).
    if (clear / (w * h) < 0.02 && corners.every((c) => c[3] > 200 && colourDistance(c[0], c[1], c[2], ref) < 0.12)) {
        mode = 'drop';
    } else if (box && solid / box > 0.6) {
        // A solid shape (badge / box) rather than strokes on transparency.
        let top: { n: number; r: number; g: number; b: number } | null = null;
        bins.forEach((bin) => {
            if (!top || bin.n > top.n) top = bin;
        });
        const main = top as { n: number; r: number; g: number; b: number } | null;
        if (main && main.n / solid >= 0.25) {
            ref = [main.r / main.n, main.g / main.n, main.b / main.n];
            mode = luma(ref[0], ref[1], ref[2]) < 0.7 ? 'cutout' : 'drop';
        } else if (lumas.length) {
            lumas.sort((a, b) => a - b);
            lo = lumas[Math.floor(lumas.length * 0.6)];
            hi = Math.max(lo + 0.05, lumas[Math.floor(lumas.length * 0.97)]);
            mode = 'highlights';
        }
    }
    if (mode === 'plain' && solid && dark / solid > 0.15 && light / solid > 0.15) mode = 'droplight';

    const refLuma = luma(ref[0], ref[1], ref[2]);
    const paint = (how: typeof mode) => {
        const frame = new ImageData(new Uint8ClampedArray(src), w, h);
        const px = frame.data;
        let kept = 0;
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];
            let alpha = px[i + 3];
            if (how === 'drop') alpha *= clamp01((colourDistance(r, g, b, ref) - 0.07) / 0.22);
            else if (how === 'cutout') alpha *= 1 - clamp01((luma(r, g, b) - refLuma - 0.1) / 0.15);
            else if (how === 'highlights') alpha *= clamp01((luma(r, g, b) - lo) / (hi - lo));
            else if (how === 'droplight') alpha *= 1 - clamp01((luma(r, g, b) - 0.55) / 0.3);
            px[i] = 255;
            px[i + 1] = 255;
            px[i + 2] = 255;
            px[i + 3] = alpha;
            kept += alpha;
        }
        return { frame, kept: kept / 255 / (w * h) };
    };
    let result = paint(mode);
    // Next to nothing left means the guess was wrong: fall back to the plain white shape.
    if (mode !== 'plain' && result.kept < 0.02) result = paint('plain');
    ctx.putImageData(result.frame, 0, 0);
    return canvas;
};

/** Finished logos survive restarts, so a tile shows its logo straight away next time. */
const STORE_PREFIX = 'smp-white-logo:v2:';
const readStored = (src: string) => {
    try {
        return window.localStorage.getItem(STORE_PREFIX + src);
    } catch {
        return null;
    }
};
const store = (src: string, blob: Blob) => {
    try {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                if (typeof reader.result === 'string') window.localStorage.setItem(STORE_PREFIX + src, reader.result);
            } catch {
                /* storage full: keep the in-memory copy only */
            }
        };
        reader.readAsDataURL(blob);
    } catch {
        /* ignore */
    }
};

const settle = (src: string, url: string | null) => {
    if (!waiting.has(src)) return;
    cache.set(src, url);
    (waiting.get(src) || []).forEach((done) => done(url));
    waiting.delete(src);
};

/** Encode off the main thread (toBlob) instead of a blocking toDataURL. */
const publish = (src: string, canvas: HTMLCanvasElement | null) => {
    if (!canvas) {
        settle(src, null);
        return;
    }
    const encodeNow = () => {
        try {
            settle(src, canvas.toDataURL('image/png'));
        } catch {
            settle(src, null);
        }
    };
    // Some TV WebViews never call toBlob back; don't leave the tile blank.
    const fallback = window.setTimeout(encodeNow, 1500);
    try {
        canvas.toBlob((blob) => {
            window.clearTimeout(fallback);
            if (!blob) {
                encodeNow();
                return;
            }
            settle(src, URL.createObjectURL(blob));
            store(src, blob);
        }, 'image/png');
    } catch {
        window.clearTimeout(fallback);
        encodeNow();
    }
};

/** Downloads run in parallel; the pixel work runs one logo at a time, yielding in between. */
const pump = () => {
    if (busy) return;
    const job = ready.shift();
    if (!job) return;
    busy = true;
    let canvas: HTMLCanvasElement | null = null;
    try {
        canvas = job.img ? whiten(job.img) : null;
    } catch {
        canvas = null;
    }
    publish(job.src, canvas);
    window.setTimeout(() => {
        busy = false;
        pump();
    }, 16);
};

const requestWhite = (src: string, done: (url: string | null) => void) => {
    if (cache.has(src)) {
        done(cache.get(src) ?? null);
        return;
    }
    const list = waiting.get(src);
    if (list) {
        list.push(done);
        return;
    }
    waiting.set(src, [done]);
    const stored = readStored(src);
    if (stored) {
        settle(src, stored);
        return;
    }
    const img = new Image();
    let queued = false;
    const enqueue = (loaded: HTMLImageElement | null) => {
        if (queued) return;
        queued = true;
        window.clearTimeout(stall);
        ready.push({ src, img: loaded });
        pump();
    };
    // A download that never finishes falls back to the filtered logo rather than nothing.
    const stall = window.setTimeout(() => enqueue(null), 10000);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => enqueue(img);
    img.onerror = () => enqueue(null);
    img.src = src;
};

type Props = {
    logoPath: string;
    alt: string;
    className?: string;
};

export const PlayerWhiteLogo: React.FC<Props> = ({ logoPath, alt, className = '' }) => {
    // Tiles show logos ~300px wide; the 780 rendition only made downloads and pixel work slower.
    const src = discoveryLogoUrl(logoPath, 300);
    const [state, setState] = useState<{ src: string; url: string | null } | null>(
        () => (cache.has(src) ? { src, url: cache.get(src) ?? null } : null),
    );

    useEffect(() => {
        if (!src) return undefined;
        let live = true;
        requestWhite(src, (url) => {
            if (live) setState({ src, url });
        });
        return () => {
            live = false;
        };
    }, [src]);

    if (!src || !state || state.src !== src) return null;
    // Canvas blocked (no CORS): fall back to the plain white filter.
    if (!state.url) {
        return <img src={src} alt={alt} draggable={false} className={`${className} brightness-0 invert`} />;
    }
    return <img src={state.url} alt={alt} draggable={false} className={className} />;
};
