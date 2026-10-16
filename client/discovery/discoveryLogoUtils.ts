import { resolvePortalAssetUrl } from '../shared/basePath';

/** TMDB logo without duotone — color preserved for auto dark detection. */
export const tmdbLogoUrl = (logoPath: string, width: 154 | 300 | 780 = 154) => {
    const path = logoPath.startsWith('/') ? logoPath : `/${logoPath}`;
    return `https://image.tmdb.org/t/p/w${width}${path}`;
};

/** Resolve TMDB paths, bundled static assets, or absolute logo URLs. */
export const discoveryLogoUrl = (logoPath: string, width: 154 | 300 | 780 = 154) => {
    const path = String(logoPath || '').trim();
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('/static/')) return resolvePortalAssetUrl(path);
    return tmdbLogoUrl(path, width);
};

const normalizeLogoPath = (logoPath: string) => {
    const path = String(logoPath || '').trim();
    if (!path) return '';
    return path.startsWith('/') ? path : `/${path}`;
};

/** Fallback when canvas sampling is blocked (CORS) — black text wordmarks only. */
const FALLBACK_DARK_LOGO_PATHS = new Set([
    '/tuomPhY2UtuPTqqFnKMVHvSb724.png', // HBO
    '/Allse9kbjiP6ExaQrnSpIhkurEi.png', // Showtime
    '/pmvRmATOCaDykE6JrVoeYxlFHw3.png', // AMC
    '/8GJjw3HHsAJYwIWKIPBPfqMxlEa.png', // Starz
]);

/** Geometric / multi-tone marks that must keep original colors (invert ruins them). */
const NEVER_INVERT_LOGO_PATHS = new Set([
    '/6mSHSquNpfLgDdv6VnOOvC5Uz2h.png', // Cinemax
    '/gIAcGTjKKr0KOHL5s4O36roJ8p7.png', // Peacock
]);

const NEVER_INVERT_LABELS = new Set(['cinemax', 'peacock']);

export const shouldNeverInvertLogo = (logoPath: string, label = '') => {
    if (NEVER_INVERT_LOGO_PATHS.has(normalizeLogoPath(logoPath))) return true;
    const normalized = String(label || '').trim().toLowerCase();
    if (NEVER_INVERT_LABELS.has(normalized)) return true;
    // Peacock Premium / Peacock TV — keep the multicolour mark.
    return normalized.includes('peacock');
};

/** Brand-color logos — no duotone, no invert (Peacock feathers, etc.). */
export const shouldPreserveColorLogo = (logoPath: string, label = '') => (
    shouldNeverInvertLogo(logoPath, label)
);

export const isKnownDarkLogoPath = (logoPath: string) => (
    FALLBACK_DARK_LOGO_PATHS.has(normalizeLogoPath(logoPath))
);

/** Fallback when logo path differs between TMDB endpoints (e.g. show details vs discover). */
export const shouldInvertByLabel = (label: string) => {
    const normalized = String(label || '').trim().toLowerCase();
    if (!normalized || NEVER_INVERT_LABELS.has(normalized)) return false;
    return (
        normalized === 'hbo'
        || normalized.includes('hbo max')
        || normalized === 'showtime'
        || normalized === 'amc'
        || normalized === 'starz'
        // Common black wordmarks on dark UI (Walt Disney Pictures, etc.)
        || normalized === 'disney'
        || normalized.includes('walt disney')
        || normalized.includes('disney pictures')
        || normalized === 'pixar'
        || normalized.includes('dreamworks')
        || normalized === 'a24'
        || normalized === 'neon'
        || normalized.includes('searchlight')
        || normalized.includes('focus features')
        || normalized.includes('miramax')
        || normalized.includes('new line')
        || normalized === 'mgm'
        || normalized.includes('legendary')
        || normalized.includes('blumhouse')
        || normalized.includes('illumination')
        || normalized.includes('bbc')
        || normalized === 'itv'
        || normalized === 'sky'
        || normalized.includes('sky atlantic')
    );
};

/**
 * Sample logo pixels — true when the mark is mostly very dark (e.g. HBO wordmark).
 * Colored logos (Netflix red, NBC peacock) stay below the invert threshold.
 */
export const isPredominantlyDarkLogo = (img: HTMLImageElement): boolean => {
    const sampleSize = 48;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

    let totalLuminance = 0;
    let opaquePixels = 0;
    let darkPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 48) continue;

        const luminance = (0.2126 * data[i]) + (0.7152 * data[i + 1]) + (0.0722 * data[i + 2]);
        totalLuminance += luminance;
        opaquePixels += 1;
        if (luminance < 40) darkPixels += 1;
    }

    if (opaquePixels < 12) return false;

    const averageLuminance = totalLuminance / opaquePixels;
    const darkRatio = darkPixels / opaquePixels;

    // Include near-black / charcoal wordmarks (e.g. Walt Disney Pictures).
    return (averageLuminance < 55 && darkRatio > 0.5)
        || (averageLuminance < 72 && darkRatio > 0.62);
};

export const shouldInvertDiscoveryLogo = (logoPath: string, label = '', img?: HTMLImageElement | null) => {
    if (shouldNeverInvertLogo(logoPath, label)) return false;
    if (isKnownDarkLogoPath(logoPath) || shouldInvertByLabel(label)) return true;
    if (!img) return false;
    try {
        return isPredominantlyDarkLogo(img);
    } catch {
        return false;
    }
};
