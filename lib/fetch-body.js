/**
 * Drain or stream fetch() bodies so node-fetch / undici cannot retain
 * unconsumed sockets and buffers (the usual cause of RSS >> JS heap).
 */
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const PROXY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export const discardFetchBody = (response) => {
    try {
        if (!response || response.bodyUsed) return;
        const body = response.body;
        if (!body) return;
        if (typeof body.cancel === 'function') {
            Promise.resolve(body.cancel()).catch(() => {});
            return;
        }
        if (typeof body.destroy === 'function') {
            body.destroy();
            return;
        }
        if (typeof body.resume === 'function') {
            body.resume();
            body.on('error', () => {});
        }
    } catch {
        // Body may already be locked or tearing down.
    }
};

const toNodeReadable = (body) => {
    if (!body) return null;
    if (typeof body.pipe === 'function') return body;
    if (typeof Readable.fromWeb === 'function' && typeof body.getReader === 'function') {
        return Readable.fromWeb(body);
    }
    return null;
};

class ByteLimitTransform extends Transform {
    constructor(maxBytes) {
        super();
        this.maxBytes = maxBytes;
        this.seen = 0;
    }

    _transform(chunk, _encoding, callback) {
        this.seen += chunk.length;
        if (this.seen > this.maxBytes) {
            const error = new Error(`Upstream body exceeds ${this.maxBytes} byte limit`);
            error.code = 'FETCH_BODY_TOO_LARGE';
            callback(error);
            return;
        }
        callback(null, chunk);
    }
}

export const pipeFetchBodyToResponse = async (response, res, { maxBytes = PROXY_IMAGE_MAX_BYTES } = {}) => {
    const nodeStream = toNodeReadable(response?.body);
    if (!nodeStream) {
        if (!res.writableEnded) res.end();
        return;
    }
    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : PROXY_IMAGE_MAX_BYTES;
    await pipeline(nodeStream, new ByteLimitTransform(limit), res);
};

export const sendFetchImage = async (res, response, {
    cacheControl = 'public, max-age=86400',
    maxBytes = PROXY_IMAGE_MAX_BYTES,
    fallbackStatus = 404,
} = {}) => {
    if (!response) {
        if (!res.headersSent) res.status(fallbackStatus).send('');
        return false;
    }
    if (!response.ok) {
        discardFetchBody(response);
        if (!res.headersSent) res.status(response.status === 404 ? 404 : fallbackStatus).send('');
        return false;
    }

    const contentType = String(response.headers?.get?.('content-type') || 'image/jpeg');
    const looksLikeImage = contentType.startsWith('image/')
        || contentType.startsWith('application/octet-stream')
        || contentType === 'application/octet-stream';
    if (!looksLikeImage) {
        discardFetchBody(response);
        if (!res.headersSent) res.status(400).send('not an image');
        return false;
    }

    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        discardFetchBody(response);
        if (!res.headersSent) res.status(502).send('');
        return false;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', cacheControl);
    if (Number.isFinite(contentLength) && contentLength > 0) {
        res.setHeader('Content-Length', String(contentLength));
    }

    try {
        await pipeFetchBodyToResponse(response, res, { maxBytes });
        return true;
    } catch {
        discardFetchBody(response);
        if (!res.headersSent) res.status(502).send('');
        else if (!res.writableEnded) res.destroy();
        return false;
    }
};

const looksLikeImageContentType = (contentType) => {
    const type = String(contentType || '');
    return type.startsWith('image/')
        || type.startsWith('application/octet-stream')
        || type === 'application/octet-stream';
};

/**
 * Read an upstream image into a Buffer so it can be cached and re-served.
 * Does not cache failures — returns null for non-images / oversize / errors.
 */
export const bufferFetchImage = async (response, { maxBytes = PROXY_IMAGE_MAX_BYTES } = {}) => {
    if (!response) return null;
    if (!response.ok) {
        discardFetchBody(response);
        return null;
    }

    const contentType = String(response.headers?.get?.('content-type') || 'image/jpeg');
    if (!looksLikeImageContentType(contentType)) {
        discardFetchBody(response);
        return null;
    }

    const limit = Number(maxBytes) > 0 ? Number(maxBytes) : PROXY_IMAGE_MAX_BYTES;
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > limit) {
        discardFetchBody(response);
        return null;
    }

    try {
        if (typeof response.arrayBuffer === 'function') {
            const body = Buffer.from(await response.arrayBuffer());
            if (!body.length || body.length > limit) return null;
            return { contentType, body };
        }
        const nodeStream = toNodeReadable(response.body);
        if (!nodeStream) return null;
        const chunks = [];
        let seen = 0;
        for await (const chunk of nodeStream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            seen += buf.length;
            if (seen > limit) {
                if (typeof nodeStream.destroy === 'function') nodeStream.destroy();
                return null;
            }
            chunks.push(buf);
        }
        const body = Buffer.concat(chunks);
        if (!body.length) return null;
        return { contentType, body };
    } catch {
        discardFetchBody(response);
        return null;
    }
};

export const sendImageBuffer = (res, { contentType, body } = {}, {
    cacheControl = 'private, max-age=604800, stale-while-revalidate=604800',
    cacheStatus,
} = {}) => {
    if (!body?.length) {
        if (!res.headersSent) res.status(404).send('');
        return false;
    }
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Content-Length', String(body.length));
    if (cacheStatus) res.setHeader('X-Media-Image-Cache', cacheStatus);
    res.send(body);
    return true;
};
