import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const isPng = (buffer) => (
    Buffer.isBuffer(buffer)
    && buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
);

const isJpeg = (buffer) => (
    Buffer.isBuffer(buffer)
    && buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
);

const decodeRaster = (buffer) => {
    if (isPng(buffer)) {
        const png = PNG.sync.read(buffer);
        return { width: png.width, height: png.height, data: png.data };
    }
    if (isJpeg(buffer)) {
        const decoded = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 64 });
        return { width: decoded.width, height: decoded.height, data: Buffer.from(decoded.data) };
    }
    return null;
};

/**
 * Cover-crop source into a circular badge, then scale the whole badge down on a
 * transparent square canvas (circle + contents shrink together).
 *
 * @param {Buffer} inputBuffer
 * @param {number} [size=192]
 * @param {{ badgeScale?: number }} [options] `badgeScale` 0.78 pads PWA launcher
 *   icons; 1 fills the canvas (favicons / in-app tab icon).
 */
export const makeCircularPwaIconPng = (inputBuffer, size = 192, { badgeScale = 0.78 } = {}) => {
    const s = Math.max(64, Math.min(1024, Number(size) || 192));
    const decoded = decodeRaster(inputBuffer);
    if (!decoded?.width || !decoded?.height || !decoded?.data?.length) {
        throw new Error('Unsupported image for circular PWA icon');
    }

    const scaleFactor = Math.max(0.5, Math.min(1, Number(badgeScale) || 0.78));
    const badgeSize = Math.max(32, Math.round(s * scaleFactor));
    const badgeOffset = Math.floor((s - badgeSize) / 2);

    const { width: srcW, height: srcH, data: src } = decoded;
    const isWide = srcW / Math.max(1, srcH) > 1.35;
    const scale = isWide
        ? Math.min(badgeSize / srcW, badgeSize / srcH) * 0.88
        : Math.max(badgeSize / srcW, badgeSize / srcH);
    const sampleW = srcW * scale;
    const sampleH = srcH * scale;
    const offsetX = (sampleW - badgeSize) / 2;
    const offsetY = (sampleH - badgeSize) / 2;

    const out = Buffer.alloc(s * s * 4);
    const radius = badgeSize / 2;
    const cx = badgeOffset + radius - 0.5;
    const cy = badgeOffset + radius - 0.5;

    for (let y = 0; y < s; y += 1) {
        for (let x = 0; x < s; x += 1) {
            const outIdx = (y * s + x) * 4;
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt((dx * dx) + (dy * dy));
            if (dist > radius) {
                out[outIdx] = 0;
                out[outIdx + 1] = 0;
                out[outIdx + 2] = 0;
                out[outIdx + 3] = 0;
                continue;
            }

            const localX = x - badgeOffset;
            const localY = y - badgeOffset;
            const srcXf = (localX + offsetX) / scale;
            const srcYf = (localY + offsetY) / scale;
            if (srcXf < 0 || srcYf < 0 || srcXf >= srcW || srcYf >= srcH) {
                out[outIdx] = 0;
                out[outIdx + 1] = 0;
                out[outIdx + 2] = 0;
                out[outIdx + 3] = 0;
                continue;
            }
            const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(srcXf)));
            const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(srcYf)));
            const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
            const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
            const xWeight = srcXf - Math.floor(srcXf);
            const yWeight = srcYf - Math.floor(srcYf);

            const sample = (sx, sy) => {
                const idx = (sy * srcW + sx) * 4;
                return [src[idx], src[idx + 1], src[idx + 2], src[idx + 3]];
            };

            const c00 = sample(x0, y0);
            const c10 = sample(x1, y0);
            const c01 = sample(x0, y1);
            const c11 = sample(x1, y1);

            for (let channel = 0; channel < 4; channel += 1) {
                const top = (c00[channel] * (1 - xWeight)) + (c10[channel] * xWeight);
                const bottom = (c01[channel] * (1 - xWeight)) + (c11[channel] * xWeight);
                out[outIdx + channel] = Math.round((top * (1 - yWeight)) + (bottom * yWeight));
            }

            if (dist > radius - 1) {
                const edge = Math.max(0, Math.min(1, radius - dist));
                out[outIdx + 3] = Math.round(out[outIdx + 3] * edge);
            }
        }
    }

    const png = new PNG({ width: s, height: s });
    out.copy(png.data);
    return PNG.sync.write(png);
};

const fillSolid = (png, rgb) => {
    for (let i = 0; i < png.width * png.height; i += 1) {
        png.data[i * 4] = rgb[0];
        png.data[i * 4 + 1] = rgb[1];
        png.data[i * 4 + 2] = rgb[2];
        png.data[i * 4 + 3] = 255;
    }
};

const sampleCover = (decoded, localX, localY, sampleW, sampleH, offsetX, offsetY, scale) => {
    const { width: srcW, height: srcH, data: src } = decoded;
    const srcXf = (localX + offsetX) / scale;
    const srcYf = (localY + offsetY) / scale;
    if (srcXf < 0 || srcYf < 0 || srcXf >= srcW || srcYf >= srcH) {
        return [0, 0, 0, 0];
    }
    const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(srcXf)));
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(srcYf)));
    const x1 = Math.max(0, Math.min(srcW - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(srcH - 1, y0 + 1));
    const xWeight = srcXf - Math.floor(srcXf);
    const yWeight = srcYf - Math.floor(srcYf);
    const sample = (sx, sy) => {
        const idx = (sy * srcW + sx) * 4;
        return [src[idx], src[idx + 1], src[idx + 2], src[idx + 3]];
    };
    const c00 = sample(x0, y0);
    const c10 = sample(x1, y0);
    const c01 = sample(x0, y1);
    const c11 = sample(x1, y1);
    const out = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
        const top = (c00[channel] * (1 - xWeight)) + (c10[channel] * xWeight);
        const bottom = (c01[channel] * (1 - xWeight)) + (c11[channel] * xWeight);
        out[channel] = Math.round((top * (1 - yWeight)) + (bottom * yWeight));
    }
    return out;
};

/**
 * Square launcher icon on an opaque background (application logo / maskable safe zone).
 */
export const makeSquarePaddedPwaIconPng = (inputBuffer, size = 192, { logoScale = 1.22, bg = [11, 15, 25] } = {}) => {
    const s = Math.max(64, Math.min(1024, Number(size) || 192));
    const decoded = decodeRaster(inputBuffer);
    if (!decoded?.width || !decoded?.height || !decoded?.data?.length) {
        throw new Error('Unsupported image for square PWA icon');
    }
    const draw = Math.max(32, Math.round(s * Math.max(0.5, Math.min(1.5, Number(logoScale) || 1.22))));
    const offset = Math.floor((s - draw) / 2);
    const { width: srcW, height: srcH } = decoded;
    const scale = Math.min(draw / srcW, draw / srcH);
    const sampleW = srcW * scale;
    const sampleH = srcH * scale;
    const offsetX = (sampleW - draw) / 2;
    const offsetY = (sampleH - draw) / 2;

    const png = new PNG({ width: s, height: s });
    fillSolid(png, bg);
    for (let y = 0; y < draw; y += 1) {
        for (let x = 0; x < draw; x += 1) {
            const [r, g, b, a] = sampleCover(decoded, x, y, sampleW, sampleH, offsetX, offsetY, scale);
            if (a <= 0) continue;
            const outIdx = ((y + offset) * s + (x + offset)) * 4;
            const alpha = a / 255;
            png.data[outIdx] = Math.round((r * alpha) + (bg[0] * (1 - alpha)));
            png.data[outIdx + 1] = Math.round((g * alpha) + (bg[1] * (1 - alpha)));
            png.data[outIdx + 2] = Math.round((b * alpha) + (bg[2] * (1 - alpha)));
            png.data[outIdx + 3] = 255;
        }
    }
    return PNG.sync.write(png);
};

/** Circular badge composited on an opaque launcher background (maskable). */
export const makeMaskablePwaIconPng = (inputBuffer, size = 512, { badgeScale = 0.88, bg = [11, 15, 25] } = {}) => {
    const circular = makeCircularPwaIconPng(inputBuffer, size, { badgeScale });
    const src = PNG.sync.read(circular);
    const out = new PNG({ width: size, height: size });
    fillSolid(out, bg);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const idx = (y * size + x) * 4;
            const alpha = src.data[idx + 3] / 255;
            if (alpha <= 0) continue;
            out.data[idx] = Math.round((src.data[idx] * alpha) + (bg[0] * (1 - alpha)));
            out.data[idx + 1] = Math.round((src.data[idx + 1] * alpha) + (bg[1] * (1 - alpha)));
            out.data[idx + 2] = Math.round((src.data[idx + 2] * alpha) + (bg[2] * (1 - alpha)));
            out.data[idx + 3] = 255;
        }
    }
    return PNG.sync.write(out);
};

const luminance = (r, g, b) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

/** Otsu threshold over 0-255 luminance values — splits mark from plate without magic constants. */
const otsuThreshold = (lums) => {
    const hist = new Float64Array(256);
    for (let k = 0; k < lums.length; k += 1) hist[clampByte(lums[k])] += 1;
    const total = lums.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i += 1) sumAll += i * hist[i];
    let sumBack = 0;
    let weightBack = 0;
    let best = 127;
    let bestVar = -1;
    for (let t = 0; t < 256; t += 1) {
        weightBack += hist[t];
        if (!weightBack) continue;
        const weightFore = total - weightBack;
        if (!weightFore) break;
        sumBack += t * hist[t];
        const meanBack = sumBack / weightBack;
        const meanFore = (sumAll - sumBack) / weightFore;
        const between = weightBack * weightFore * ((meanBack - meanFore) ** 2);
        if (between > bestVar) {
            bestVar = between;
            best = t;
        }
    }
    return best;
};

/**
 * Drop speckle so only the substantial letterforms survive: remove 4-connected
 * components smaller than an absolute floor or 25% of the largest component
 * (kills tiny wordmarks, ring flecks, and gradient noise in detailed crests).
 */
const keepMajorComponents = (mask, size) => {
    const labels = new Int32Array(size * size);
    const areas = [0];
    const stack = new Int32Array(size * size);
    let nextLabel = 1;
    for (let start = 0; start < size * size; start += 1) {
        if (!mask[start] || labels[start]) continue;
        const label = nextLabel;
        nextLabel += 1;
        let area = 0;
        let top = 0;
        stack[top] = start;
        top += 1;
        labels[start] = label;
        while (top > 0) {
            top -= 1;
            const i = stack[top];
            area += 1;
            const x = i % size;
            const y = (i - x) / size;
            const neighbors = [
                x > 0 ? i - 1 : -1,
                x < size - 1 ? i + 1 : -1,
                y > 0 ? i - size : -1,
                y < size - 1 ? i + size : -1,
            ];
            for (const n of neighbors) {
                if (n >= 0 && mask[n] && !labels[n]) {
                    labels[n] = label;
                    stack[top] = n;
                    top += 1;
                }
            }
        }
        areas[label] = area;
    }
    if (nextLabel === 1) return 0;

    const largest = Math.max(...areas);
    const minArea = Math.max(9, Math.round(size * size * 0.002), Math.round(largest * 0.25));
    let kept = 0;
    for (let i = 0; i < size * size; i += 1) {
        if (!mask[i]) continue;
        if (areas[labels[i]] < minArea) mask[i] = 0;
        else kept += 1;
    }
    return kept;
};

/** Square dilation (Chebyshev radius) — bolden thin strokes so 24dp rendering stays legible. */
const dilateMask = (mask, size, radius) => {
    if (radius < 1) return mask;
    const pass = (src, horizontal) => {
        const out = Buffer.alloc(size * size);
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const i = y * size + x;
                if (src[i]) {
                    out[i] = 1;
                    continue;
                }
                for (let d = 1; d <= radius; d += 1) {
                    const a = horizontal ? x - d : y - d;
                    const b = horizontal ? x + d : y + d;
                    const limit = size - 1;
                    if ((a >= 0 && src[horizontal ? i - d : i - (d * size)])
                        || (b <= limit && src[horizontal ? i + d : i + (d * size)])) {
                        out[i] = 1;
                        break;
                    }
                }
            }
        }
        return out;
    };
    return pass(pass(mask, true), false);
};

/** Square erosion — inverse of dilate; strips structures thinner than 2*radius+1 px. */
const erodeMask = (mask, size, radius) => {
    if (radius < 1) return mask;
    const pass = (src, horizontal) => {
        const out = Buffer.alloc(size * size);
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const i = y * size + x;
                if (!src[i]) continue;
                let keep = 1;
                for (let d = 1; d <= radius; d += 1) {
                    const a = horizontal ? x - d : y - d;
                    const b = horizontal ? x + d : y + d;
                    if (a < 0 || b > size - 1
                        || !src[horizontal ? i - d : i - (d * size)]
                        || !src[horizontal ? i + d : i + (d * size)]) {
                        keep = 0;
                        break;
                    }
                }
                out[i] = keep;
            }
        }
        return out;
    };
    return pass(pass(mask, true), false);
};

/** One 3x3 box blur over alpha — hard binary edges alias badly when Android scales to 24dp. */
const featherAlpha = (alpha, size) => {
    const out = Buffer.alloc(size * size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let sum = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
                    sum += alpha[ny * size + nx];
                    count += 1;
                }
            }
            out[y * size + x] = Math.round(sum / count);
        }
    }
    return out;
};

/**
 * Convert an admin-uploaded badge image straight into a status-bar alpha mask —
 * no shape extraction, the upload IS the mask. Transparent PNGs keep their own
 * alpha (anti-aliasing preserved); flat images map luminance to coverage, with
 * polarity picked from the border tone (white-on-black vs black-on-white).
 * The visible mark is zoomed to fill the canvas like the auto-generated badge.
 */
export const makeNotificationBadgeMaskPng = (inputBuffer, size = 96) => {
    const s = Math.max(48, Math.min(256, Number(size) || 96));
    const decoded = decodeRaster(inputBuffer);
    if (!decoded?.width || !decoded?.height || !decoded?.data?.length) {
        throw new Error('Unsupported image for notification badge');
    }

    const { width: srcW, height: srcH } = decoded;
    const fitScale = Math.min(s / srcW, s / srcH);
    const drawW = Math.max(1, Math.round(srcW * fitScale));
    const drawH = Math.max(1, Math.round(srcH * fitScale));
    const offX = Math.floor((s - drawW) / 2);
    const offY = Math.floor((s - drawH) / 2);

    const srcAlpha = Buffer.alloc(s * s);
    const srcLum = Buffer.alloc(s * s);
    let transparent = 0;
    let drawn = 0;
    for (let y = 0; y < drawH; y += 1) {
        for (let x = 0; x < drawW; x += 1) {
            const [r, g, b, a] = sampleCover(decoded, x, y, srcW * fitScale, srcH * fitScale, 0, 0, fitScale);
            const i = (y + offY) * s + (x + offX);
            srcAlpha[i] = a;
            srcLum[i] = clampByte(luminance(r, g, b));
            drawn += 1;
            if (a < 40) transparent += 1;
        }
    }

    const alpha = Buffer.alloc(s * s);
    if (transparent / Math.max(1, drawn) > 0.05) {
        // Transparent upload: the alpha channel is the mask, verbatim.
        srcAlpha.copy(alpha);
    } else {
        // Flat upload: border tone tells us the background polarity.
        let borderSum = 0;
        let borderCount = 0;
        for (let x = offX; x < offX + drawW; x += 1) {
            borderSum += srcLum[offY * s + x] + srcLum[(offY + drawH - 1) * s + x];
            borderCount += 2;
        }
        for (let y = offY; y < offY + drawH; y += 1) {
            borderSum += srcLum[y * s + offX] + srcLum[y * s + offX + drawW - 1];
            borderCount += 2;
        }
        const darkBackground = borderSum / Math.max(1, borderCount) < 128;
        for (let i = 0; i < s * s; i += 1) {
            if (!srcAlpha[i]) continue;
            alpha[i] = darkBackground ? srcLum[i] : 255 - srcLum[i];
        }
    }

    // Zoom the visible mark to fill the canvas (uploads often carry padding).
    let minX = s;
    let maxX = 0;
    let minY = s;
    let maxY = 0;
    for (let i = 0; i < s * s; i += 1) {
        if (alpha[i] < 16) continue;
        const x = i % s;
        const y = (i - x) / s;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const out = new PNG({ width: s, height: s });
    if (maxX < minX) return PNG.sync.write(out);

    const markW = maxX - minX + 1;
    const markH = maxY - minY + 1;
    const zoom = Math.min((s * 0.92) / markW, (s * 0.92) / markH);
    const originX = (s - (markW * zoom)) / 2;
    const originY = (s - (markH * zoom)) / 2;
    for (let y = 0; y < s; y += 1) {
        for (let x = 0; x < s; x += 1) {
            const srcX = minX + ((x - originX) / zoom);
            const srcY = minY + ((y - originY) / zoom);
            if (srcX < minX - 1 || srcX > maxX + 1 || srcY < minY - 1 || srcY > maxY + 1) continue;
            const x0 = Math.max(0, Math.min(s - 1, Math.floor(srcX)));
            const y0 = Math.max(0, Math.min(s - 1, Math.floor(srcY)));
            const x1 = Math.min(s - 1, x0 + 1);
            const y1 = Math.min(s - 1, y0 + 1);
            const fx = srcX - Math.floor(srcX);
            const fy = srcY - Math.floor(srcY);
            const top = (alpha[y0 * s + x0] * (1 - fx)) + (alpha[y0 * s + x1] * fx);
            const bottom = (alpha[y1 * s + x0] * (1 - fx)) + (alpha[y1 * s + x1] * fx);
            const idx = (y * s + x) * 4;
            out.data[idx] = 255;
            out.data[idx + 1] = 255;
            out.data[idx + 2] = 255;
            out.data[idx + 3] = clampByte((top * (1 - fy)) + (bottom * fy));
        }
    }
    return PNG.sync.write(out);
};

/**
 * Android Chrome status-bar icons (`Notification.badge`) are an alpha mask:
 * only white-on-transparent shapes render — the OS tints them, so full colour
 * is impossible for every app. Best case is a crisp bold silhouette. Extract
 * the dominant mark (e.g. the SZ letterforms) via Otsu threshold, drop small
 * speckle (tiny wordmarks / ring flecks), bolden, and anti-alias the edge.
 */
export const makeNotificationBadgePng = (inputBuffer, size = 96) => {
    const s = Math.max(48, Math.min(256, Number(size) || 96));
    const decoded = decodeRaster(inputBuffer);
    if (!decoded?.width || !decoded?.height || !decoded?.data?.length) {
        throw new Error('Unsupported image for notification badge');
    }

    const { width: srcW, height: srcH } = decoded;
    const fitScale = Math.min(s / srcW, s / srcH);
    const drawW = Math.max(1, Math.round(srcW * fitScale));
    const drawH = Math.max(1, Math.round(srcH * fitScale));
    const offX = Math.floor((s - drawW) / 2);
    const offY = Math.floor((s - drawH) / 2);

    const rgba = Buffer.alloc(s * s * 4);
    for (let y = 0; y < drawH; y += 1) {
        for (let x = 0; x < drawW; x += 1) {
            const [r, g, b, a] = sampleCover(decoded, x, y, srcW * fitScale, srcH * fitScale, 0, 0, fitScale);
            const idx = ((y + offY) * s + (x + offX)) * 4;
            rgba[idx] = r;
            rgba[idx + 1] = g;
            rgba[idx + 2] = b;
            rgba[idx + 3] = a;
        }
    }

    const out = new PNG({ width: s, height: s });
    const writeMask = (alpha) => {
        const feathered = featherAlpha(alpha, s);
        for (let i = 0; i < s * s; i += 1) {
            out.data[i * 4] = 255;
            out.data[i * 4 + 1] = 255;
            out.data[i * 4 + 2] = 255;
            out.data[i * 4 + 3] = feathered[i];
        }
        return PNG.sync.write(out);
    };

    // Fallback: the logo's own opaque footprint (clean disc / wordmark shape).
    const silhouette = () => {
        const alpha = Buffer.alloc(s * s);
        for (let i = 0; i < s * s; i += 1) {
            alpha[i] = rgba[i * 4 + 3] >= 40 ? 255 : 0;
        }
        return writeMask(alpha);
    };

    const opaqueIdx = [];
    const lums = [];
    let lumMin = 255;
    let lumMax = 0;
    for (let i = 0; i < s * s; i += 1) {
        if (rgba[i * 4 + 3] < 120) continue;
        const lum = luminance(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
        opaqueIdx.push(i);
        lums.push(lum);
        if (lum < lumMin) lumMin = lum;
        if (lum > lumMax) lumMax = lum;
    }

    // Flat-colour logos have no internal mark to extract — the shape is the mark.
    if (opaqueIdx.length < 16 || lumMax - lumMin < 48) return silhouette();

    const sorted = [...lums].sort((a, b) => a - b);
    const percentile = (q) => sorted[Math.floor(q * (sorted.length - 1))];
    const otsu = otsuThreshold(lums);

    // Roughly square logos are plates (circular crests): the mark sits centrally,
    // so restrict extraction to a central circular window — outer rings, edge
    // glints, and plate crescents can never win. Wide wordmarks skip this.
    let minX = s;
    let maxX = 0;
    let minY = s;
    let maxY = 0;
    for (const i of opaqueIdx) {
        const x = i % s;
        const y = (i - x) / s;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const bboxW = maxX - minX + 1;
    const bboxH = maxY - minY + 1;
    const aspect = bboxW / Math.max(1, bboxH);
    let allowed = null;
    if (aspect >= 0.75 && aspect <= 1.33) {
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const windowRadius = 0.7 * (Math.min(bboxW, bboxH) / 2);
        allowed = Buffer.alloc(s * s);
        for (let i = 0; i < s * s; i += 1) {
            const x = i % s;
            const y = (i - x) / s;
            const dx = x - centerX;
            const dy = y - centerY;
            if ((dx * dx) + (dy * dy) <= windowRadius * windowRadius) allowed[i] = 1;
        }
    }

    let windowOpaque = 0;
    for (const i of opaqueIdx) {
        if (!allowed || allowed[i]) windowOpaque += 1;
    }
    if (!windowOpaque) return silhouette();

    // Build a candidate mask, then clean it: despeckle, close patchy gradient
    // strokes (dilate), erode away hairline arcs/glints, despeckle fragments.
    // Reject plate-sized blobs — a readable mark covers ~5-38% of its plate.
    const buildCleanMask = (threshold, keepLight) => {
        const mask = Buffer.alloc(s * s);
        let count = 0;
        for (let k = 0; k < opaqueIdx.length; k += 1) {
            const i = opaqueIdx[k];
            if (allowed && !allowed[i]) continue;
            const keep = keepLight ? lums[k] >= threshold : lums[k] < threshold;
            if (keep) {
                mask[i] = 1;
                count += 1;
            }
        }
        const frac = count / windowOpaque;
        if (frac < 0.04 || frac > 0.55) return null;
        keepMajorComponents(mask, s);
        let cleaned = dilateMask(mask, s, 1);
        cleaned = erodeMask(cleaned, s, 2);
        const kept = keepMajorComponents(cleaned, s);
        if (kept < Math.round(s * s * 0.01)) return null;
        const keptFrac = kept / windowOpaque;
        if (keptFrac < 0.05 || keptFrac > 0.5) return null;
        // Solid letterforms survive close-open nearly intact; rings, glints, and
        // gradient mush lose most of their pixels. Score by survival.
        return { mask: cleaned, kept, survival: kept / count, threshold, keepLight };
    };

    // Chrome/gradient letterforms don't split cleanly at one threshold — try
    // Otsu plus percentile cuts, light side first (light mark on a dark plate is
    // the common branding layout), and keep whichever preserves the most solid
    // mark after morphology (mush erodes away, letters survive).
    const lightCandidates = [otsu, percentile(0.62), percentile(0.7), percentile(0.78)];
    const darkCandidates = [otsu, percentile(0.38), percentile(0.3), percentile(0.22)];
    let best = null;
    for (const threshold of lightCandidates) {
        const candidate = buildCleanMask(threshold, true);
        if (candidate && (!best || candidate.survival > best.survival)) best = candidate;
    }
    if (!best) {
        for (const threshold of darkCandidates) {
            const candidate = buildCleanMask(threshold, false);
            if (candidate && (!best || candidate.survival > best.survival)) best = candidate;
        }
    }
    if (!best) return silhouette();

    // Gradient letterforms fade toward the plate, so the winning threshold clips
    // them. Region-grow from the confirmed mark into adjacent opaque pixels that
    // are still clearly mark-side of the plate tone to recover full letters.
    const lumByIdx = new Float32Array(s * s);
    for (let k = 0; k < opaqueIdx.length; k += 1) lumByIdx[opaqueIdx[k]] = lums[k];
    const plateTone = best.keepLight ? percentile(0.35) : percentile(0.65);
    const relaxed = best.threshold - (0.35 * (best.threshold - plateTone));
    const growthCap = Math.round(best.kept * 0.8);
    let grown = Buffer.from(best.mask);
    const queue = [];
    for (let i = 0; i < s * s; i += 1) {
        if (grown[i]) queue.push(i);
    }
    let added = 0;
    while (queue.length && added <= growthCap) {
        const i = queue.pop();
        const x = i % s;
        const y = (i - x) / s;
        const neighbors = [
            x > 0 ? i - 1 : -1,
            x < s - 1 ? i + 1 : -1,
            y > 0 ? i - s : -1,
            y < s - 1 ? i + s : -1,
        ];
        for (const n of neighbors) {
            if (n < 0 || grown[n]) continue;
            if (rgba[n * 4 + 3] < 120) continue;
            if (allowed && !allowed[n]) continue;
            const pass = best.keepLight ? lumByIdx[n] >= relaxed : lumByIdx[n] <= relaxed;
            if (!pass) continue;
            grown[n] = 1;
            added += 1;
            queue.push(n);
        }
    }
    // Growth that balloons means it leaked into plate texture — discard it.
    if (added > growthCap) grown = best.mask;

    // Restore eroded weight with an extra pixel of boldness for 24dp legibility.
    const bold = dilateMask(grown, s, 2);

    // The extracted mark is a small crop of the full crest — zoom it to fill the
    // canvas so Android's 24dp rendering shows the letters as large as possible.
    let markMinX = s;
    let markMaxX = 0;
    let markMinY = s;
    let markMaxY = 0;
    for (let i = 0; i < s * s; i += 1) {
        if (!bold[i]) continue;
        const x = i % s;
        const y = (i - x) / s;
        if (x < markMinX) markMinX = x;
        if (x > markMaxX) markMaxX = x;
        if (y < markMinY) markMinY = y;
        if (y > markMaxY) markMaxY = y;
    }
    const markW = markMaxX - markMinX + 1;
    const markH = markMaxY - markMinY + 1;
    const zoom = Math.min((s * 0.92) / markW, (s * 0.92) / markH);
    const outW = markW * zoom;
    const outH = markH * zoom;
    const originX = (s - outW) / 2;
    const originY = (s - outH) / 2;
    const alpha = Buffer.alloc(s * s);
    for (let y = 0; y < s; y += 1) {
        for (let x = 0; x < s; x += 1) {
            const srcX = markMinX + ((x - originX) / zoom);
            const srcY = markMinY + ((y - originY) / zoom);
            if (srcX < markMinX - 1 || srcX > markMaxX + 1 || srcY < markMinY - 1 || srcY > markMaxY + 1) continue;
            const x0 = Math.max(0, Math.min(s - 1, Math.floor(srcX)));
            const y0 = Math.max(0, Math.min(s - 1, Math.floor(srcY)));
            const x1 = Math.min(s - 1, x0 + 1);
            const y1 = Math.min(s - 1, y0 + 1);
            const fx = srcX - Math.floor(srcX);
            const fy = srcY - Math.floor(srcY);
            const top = (bold[y0 * s + x0] * (1 - fx)) + (bold[y0 * s + x1] * fx);
            const bottom = (bold[y1 * s + x0] * (1 - fx)) + (bold[y1 * s + x1] * fx);
            alpha[y * s + x] = clampByte(((top * (1 - fy)) + (bottom * fy)) * 255);
        }
    }
    return writeMask(alpha);
};

