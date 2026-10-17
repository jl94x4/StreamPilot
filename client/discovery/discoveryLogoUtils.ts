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
    if (path.startsWith('/static/')) {
        // Capacitor APK ships logos under dist/static — prefer same-origin over portal.
        try {
            if (typeof window !== 'undefined' && window.__PLEX_CLIENT__) {
                return path;
            }
        } catch {
            // fall through
        }
        return resolvePortalAssetUrl(path);
    }
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

/**
 * Coloured / multi-tone plates that blank when forced white.
 * Includes bundled Marvel red plate + TMDB CDN originals.
 */
const NEVER_INVERT_LOGO_PATHS = new Set([
    '/6mSHSquNpfLgDdv6VnOOvC5Uz2h.png', // Cinemax
    '/gIAcGTjKKr0KOHL5s4O36roJ8p7.png', // Peacock
    '/hUzeosd33nzE5MCNsZxCGEKTXaQ.png', // Marvel Studios TMDB red plate
    '/2Tc1P3Ac8M479naPp1kYT3izLS5.png', // DC TMDB plate
    '/static/logos/marvel-studios.png',
    '/static/logos/dc.png',
    '/static/logos/illumination.png',
    '/static/logos/sony-pictures.png',
    '/static/logos/mgm.png',
    '/static/logos/discovery-plus.svg',
    '/static/logos/netflix.svg',
    '/static/logos/prime-video.svg',
    '/static/logos/apple-tv.svg',
    '/static/logos/hbo.svg',
    '/static/logos/itv.svg',
    '/static/logos/sky.svg',
]);

/**
 * Dark / brand-blue wordmarks — invert to white on dark billboards.
 * (Disney+ / Universal blue is hard to read on TV stills.)
 */
const FORCE_INVERT_STATIC_PATHS = new Set([
    '/static/logos/bbc.png',
    '/static/logos/channel-4.png',
    '/static/logos/channel-5.png',
    '/static/logos/cbeebies.png',
    '/static/logos/sky-originals.png',
    '/static/logos/disney.png',
    '/static/logos/disney-plus.svg',
    '/static/logos/universal.png',
]);

const NEVER_INVERT_LABELS = new Set([
    'cinemax',
    'peacock',
    'marvel',
    'marvel studios',
    'dc',
    'dc comics',
    'discovery+',
    'discovery plus',
    'illumination',
]);

export const isBundledDarkWordmarkLogo = (logoPath: string) => (
    FORCE_INVERT_STATIC_PATHS.has(normalizeLogoPath(logoPath))
);

export const shouldNeverInvertLogo = (logoPath: string, label = '') => {
    const path = normalizeLogoPath(logoPath);
    if (FORCE_INVERT_STATIC_PATHS.has(path)) return false;
    // Bundled studio/network graphics (Marvel plate, whitened Disney, etc.) keep authored colours.
    if (path.startsWith('/static/logos/') && !FORCE_INVERT_STATIC_PATHS.has(path)) return true;
    if (NEVER_INVERT_LOGO_PATHS.has(path)) return true;
    const normalized = String(label || '').trim().toLowerCase();
    if (NEVER_INVERT_LABELS.has(normalized)) return true;
    if (normalized.includes('peacock')) return true;
    if (normalized.includes('marvel')) return true;
    if (normalized === 'discovery+' || normalized === 'discovery plus') return true;
    return false;
};

/** Brand-color logos — no duotone, no invert (Marvel plate, Peacock, Discovery+, …). */
export const shouldPreserveColorLogo = (logoPath: string, label = '') => (
    shouldNeverInvertLogo(logoPath, label)
);

export const isKnownDarkLogoPath = (logoPath: string) => (
    FALLBACK_DARK_LOGO_PATHS.has(normalizeLogoPath(logoPath))
    || isBundledDarkWordmarkLogo(logoPath)
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
        || normalized === 'disney'
        || normalized === 'disney+'
        || normalized === 'disney plus'
        || normalized.includes('walt disney')
        || normalized.includes('disney pictures')
        || normalized === 'universal'
        || normalized.includes('universal pictures')
        || normalized.includes('universal studios')
        || normalized === 'pixar'
        || normalized.includes('dreamworks')
        || normalized === 'a24'
        || normalized === 'neon'
        || normalized.includes('searchlight')
        || normalized.includes('focus features')
        || normalized.includes('miramax')
        || normalized.includes('new line')
        || normalized.includes('legendary')
        || normalized.includes('blumhouse')
        || normalized.includes('bbc')
        || normalized === 'itv'
        || normalized === 'sky'
        || normalized.includes('sky atlantic')
        || normalized.includes('channel 4')
        || normalized.includes('channel 5')
        || normalized.includes('paramount')
        || normalized.includes('warner')
        || normalized.includes('columbia')
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
