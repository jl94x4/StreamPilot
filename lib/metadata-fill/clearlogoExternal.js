/**
 * External clearlogo resolve: TMDB logos, PNG-only download + validate.
 */

import { createTmdbClient } from '../portal-request/tmdbClient.js';

export const TMDB_IMAGE_ORIGINAL_BASE = 'https://image.tmdb.org/t/p/original';
/** Soft cap under Plex's ~10MB artwork upload limit. */
export const CLEARLOGO_PNG_MAX_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

/** Local copy to avoid circular import with plexWrite. */
export const tmdbIdFromPlexMeta = (metadata = {}) => {
    const guids = [];
    for (const entry of asArray(metadata?.Guid)) {
        if (entry?.id) guids.push(String(entry.id));
    }
    if (metadata?.guid) guids.push(String(metadata.guid));
    if (metadata?.grandparentGuid) guids.push(String(metadata.grandparentGuid));
    if (metadata?.parentGuid) guids.push(String(metadata.parentGuid));
    for (const raw of guids) {
        const match = String(raw).match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
        if (match) return match[1];
    }
    return null;
};

export const isPngFilePath = (filePath = '') => /\.png$/i.test(String(filePath || '').trim());

export const tmdbOriginalImageUrl = (filePath = '') => {
    const path = String(filePath || '').trim();
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    return `${TMDB_IMAGE_ORIGINAL_BASE}${path.startsWith('/') ? path : `/${path}`}`;
};

export const isPngBuffer = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < PNG_MAGIC.length) return false;
    return PNG_MAGIC.equals(buffer.subarray(0, PNG_MAGIC.length));
};

/**
 * Prefer English / null-language PNG logos; higher vote_average wins ties.
 * @param {object[]} logos
 * @returns {object|null}
 */
export const pickBestTmdbPngLogo = (logos = []) => {
    const rows = (Array.isArray(logos) ? logos : [])
        .filter((row) => isPngFilePath(row?.file_path))
        .map((row) => ({
            filePath: String(row.file_path).trim(),
            language: row?.iso_639_1 == null ? '' : String(row.iso_639_1).trim().toLowerCase(),
            voteAverage: Number(row?.vote_average) || 0,
            voteCount: Number(row?.vote_count) || 0,
            width: Number(row?.width) || 0,
            height: Number(row?.height) || 0,
        }));
    if (!rows.length) return null;

    const rank = (row) => {
        if (row.language === 'en') return 0;
        if (!row.language) return 1;
        return 2;
    };

    rows.sort((a, b) => {
        const langDiff = rank(a) - rank(b);
        if (langDiff !== 0) return langDiff;
        if (b.voteAverage !== a.voteAverage) return b.voteAverage - a.voteAverage;
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
        return (b.width * b.height) - (a.width * a.height);
    });

    const best = rows[0];
    return {
        filePath: best.filePath,
        url: tmdbOriginalImageUrl(best.filePath),
        language: best.language || null,
        voteAverage: best.voteAverage,
        source: 'tmdb',
    };
};

/**
 * Download a PNG clearlogo; reject non-PNG content.
 * @returns {Promise<{ buffer: Buffer, contentType: string, url: string, bytes: number }>}
 */
export const downloadPngClearLogo = async (url, { fetchImpl = fetch, maxBytes = CLEARLOGO_PNG_MAX_BYTES } = {}) => {
    const target = String(url || '').trim();
    if (!target || !/^https?:\/\//i.test(target)) {
        const err = new Error('Clearlogo URL is required');
        err.code = 'CLEARLOGO_URL_REQUIRED';
        throw err;
    }
    const response = await fetchImpl(target, {
        headers: {
            Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
            'User-Agent': 'StreamPilot-MetadataFill/1.0',
        },
    });
    if (!response?.ok) {
        const err = new Error(`Clearlogo download HTTP ${response?.status || 0}`);
        err.status = response?.status || 0;
        err.code = 'CLEARLOGO_DOWNLOAD_FAILED';
        throw err;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
        const err = new Error('Clearlogo download was empty');
        err.code = 'CLEARLOGO_EMPTY';
        throw err;
    }
    if (buffer.length > maxBytes) {
        const err = new Error(`Clearlogo PNG exceeds ${maxBytes} bytes`);
        err.code = 'CLEARLOGO_TOO_LARGE';
        throw err;
    }
    const headerType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!isPngBuffer(buffer)) {
        const err = new Error(
            headerType && headerType !== 'image/png'
                ? `Clearlogo is not PNG (${headerType})`
                : 'Clearlogo is not a valid PNG',
        );
        err.code = 'CLEARLOGO_NOT_PNG';
        throw err;
    }
    return {
        buffer,
        contentType: 'image/png',
        url: target,
        bytes: buffer.length,
    };
};

/**
 * Resolve a TMDB PNG clearlogo for a Plex movie/show metadata object.
 * @returns {Promise<null|{ filePath: string, url: string, language: string|null, voteAverage: number, source: string, tmdbId: string }>}
 */
export const resolveExternalPngClearLogo = async ({
    metadata = null,
    type = 'movie',
    tmdbApiKey = '',
    tmdbId = null,
    fetchImpl = fetch,
    tmdbClient = null,
} = {}) => {
    const mediaType = String(type || '') === 'show' ? 'tv' : 'movie';
    const id = String(tmdbId || tmdbIdFromPlexMeta(metadata || {}) || '').replace(/\D/g, '');
    if (!id) {
        return null;
    }
    const key = String(tmdbApiKey || '').trim();
    if (!key && !tmdbClient) {
        return null;
    }
    const client = tmdbClient || createTmdbClient({ tmdbApiKey: key, fetchImpl });
    const images = await client.images(mediaType, id).catch(() => null);
    if (!images) return null;
    const best = pickBestTmdbPngLogo(images.logos);
    if (!best) return null;
    return {
        ...best,
        tmdbId: id,
        mediaType,
    };
};

/**
 * Resolve + download PNG bytes ready for Plex upload.
 */
export const fetchExternalPngClearLogo = async (opts = {}) => {
    const resolved = await resolveExternalPngClearLogo(opts);
    if (!resolved?.url) {
        return { resolved: null, image: null };
    }
    const image = await downloadPngClearLogo(resolved.url, {
        fetchImpl: opts.fetchImpl || fetch,
    });
    return { resolved, image };
};
