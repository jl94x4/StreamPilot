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

const MAX_WIDTH = 480;
const cache = new Map<string, string | null>();
const waiting = new Map<string, Array<(url: string | null) => void>>();
const queue: string[] = [];
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
 * - plain: ordinary transparent logo — a white silhouette.
 */
const whiten = (img: HTMLImageElement): string | null => {
    const scale = Math.min(1, MAX_WIDTH / Math.max(1, img.naturalWidth));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    const px = frame.data;

    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
        const i = (y * w + x) * 4;
        return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    });
    let ref: Rgb = [0, 1, 2].map((k) => corners.reduce((sum, c) => sum + c[k], 0) / 4) as Rgb;
    let mode: 'plain' | 'drop' | 'cutout' | 'highlights' = 'plain';
    let lo = 0;
    let hi = 1;
    if (corners.every((c) => c[3] > 200 && colourDistance(c[0], c[1], c[2], ref) < 0.12)) {
        mode = 'drop';
    } else {
        let minX = w, minY = h, maxX = -1, maxY = -1, solid = 0;
        const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
        const lumas: number[] = [];
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const i = (y * w + x) * 4;
                if (px[i + 3] < 160) continue;
                solid += 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if ((solid & 3) === 0) lumas.push(luma(px[i], px[i + 1], px[i + 2]));
                const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
                const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
                bin.n += 1;
                bin.r += px[i];
                bin.g += px[i + 1];
                bin.b += px[i + 2];
                bins.set(key, bin);
            }
        }
        const box = maxX >= minX ? (maxX - minX + 1) * (maxY - minY + 1) : 0;
        // A solid shape (badge / box) rather than strokes on transparency.
        if (box && solid / box > 0.6) {
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
    }

    const refLuma = luma(ref[0], ref[1], ref[2]);
    for (let i = 0; i < px.length; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];
        let alpha = px[i + 3];
        if (mode === 'drop') alpha *= clamp01((colourDistance(r, g, b, ref) - 0.07) / 0.22);
        else if (mode === 'cutout') alpha *= 1 - clamp01((luma(r, g, b) - refLuma - 0.1) / 0.15);
        else if (mode === 'highlights') alpha *= clamp01((luma(r, g, b) - lo) / (hi - lo));
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = alpha;
    }
    ctx.putImageData(frame, 0, 0);
    try {
        return canvas.toDataURL('image/png');
    } catch {
        return null;
    }
};

const settle = (src: string, url: string | null) => {
    cache.set(src, url);
    (waiting.get(src) || []).forEach((done) => done(url));
    waiting.delete(src);
};

/** One logo at a time, yielding between them so D-pad input stays responsive. */
const pump = () => {
    if (busy) return;
    const src = queue.shift();
    if (!src) return;
    busy = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const next = (url: string | null) => {
        settle(src, url);
        busy = false;
        window.setTimeout(pump, 16);
    };
    img.onload = () => {
        try {
            next(whiten(img));
        } catch {
            next(null);
        }
    };
    img.onerror = () => next(null);
    img.src = src;
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
    queue.push(src);
    pump();
};

type Props = {
    logoPath: string;
    alt: string;
    className?: string;
};

export const PlayerWhiteLogo: React.FC<Props> = ({ logoPath, alt, className = '' }) => {
    const src = discoveryLogoUrl(logoPath, 780);
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
