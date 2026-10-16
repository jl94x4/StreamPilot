const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;

const headerName = (headers, fieldName) => {
    const quoted = headers.match(new RegExp(`name="${fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'));
    if (quoted) return true;
    const bare = headers.match(new RegExp(`name=${fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:;|\\s|$)`, 'i'));
    return !!bare;
};

/**
 * Extract a text form field from a Plex-style multipart body without pulling in multer.
 * Payload is JSON; the optional `thumb` part is ignored.
 */
export const extractMultipartFormField = (buffer, contentType, fieldName) => {
    const boundaryMatch = String(contentType || '').match(/boundary\s*=\s*(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) return null;
    const boundary = `--${(boundaryMatch[1] || boundaryMatch[2] || '').trim()}`;
    if (boundary === '--') return null;
    const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const boundBuf = Buffer.from(boundary);
    const headerSep = Buffer.from('\r\n\r\n');
    let offset = 0;
    while (offset < raw.length) {
        const boundAt = raw.indexOf(boundBuf, offset);
        if (boundAt < 0) break;
        let partStart = boundAt + boundBuf.length;
        if (raw[partStart] === 0x2d && raw[partStart + 1] === 0x2d) break;
        if (raw[partStart] === 0x0d && raw[partStart + 1] === 0x0a) partStart += 2;
        const nextBound = raw.indexOf(boundBuf, partStart);
        if (nextBound < 0) break;
        const part = raw.subarray(partStart, nextBound);
        const sep = part.indexOf(headerSep);
        if (sep >= 0) {
            const headers = part.subarray(0, sep).toString('utf8');
            if (headerName(headers, fieldName)) {
                let value = part.subarray(sep + 4);
                if (value.length >= 2 && value[value.length - 2] === 0x0d && value[value.length - 1] === 0x0a) {
                    value = value.subarray(0, value.length - 2);
                }
                return value.toString('utf8');
            }
        }
        offset = nextBound;
    }
    return null;
};

export const parseWebhookJson = (value) => {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    const text = String(value).trim();
    if (!text) return null;
    return JSON.parse(text);
};

const payloadFromParsedBody = (body) => {
    if (body == null) return null;
    if (typeof body === 'string') return parseWebhookJson(body);
    if (typeof body !== 'object') return null;
    if (body.payload != null) return parseWebhookJson(body.payload);
    if (body.event || body.Metadata) return body;
    return null;
};

export const readRequestBuffer = (req, { limit = DEFAULT_BODY_LIMIT } = {}) => new Promise((resolve, reject) => {
    if (Buffer.isBuffer(req._editionsRawBody)) {
        resolve(req._editionsRawBody);
        return;
    }
    if (req.readableEnded) {
        resolve(Buffer.alloc(0));
        return;
    }
    const chunks = [];
    let size = 0;
    const fail = (error) => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        reject(error);
    };
    const onData = (chunk) => {
        size += chunk.length;
        if (size > limit) {
            const error = new Error('payload too large');
            error.status = 413;
            fail(error);
            return;
        }
        chunks.push(chunk);
    };
    const onEnd = () => {
        const buf = Buffer.concat(chunks);
        req._editionsRawBody = buf;
        resolve(buf);
    };
    const onError = (error) => fail(error);
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    if (typeof req.resume === 'function') req.resume();
});

/**
 * Resolve the Plex webhook JSON from JSON, urlencoded `payload=`, or multipart `payload`.
 */
export const resolvePlexWebhookPayload = async (req) => {
    const fromBody = payloadFromParsedBody(req.body);
    if (fromBody) return fromBody;

    const contentType = String(req.headers?.['content-type'] || req.get?.('content-type') || '');
    if (!/multipart\/form-data/i.test(contentType)) return null;

    const raw = await readRequestBuffer(req);
    if (!raw.length) return null;
    const field = extractMultipartFormField(raw, contentType, 'payload');
    return field ? parseWebhookJson(field) : null;
};

export const editionsWebhookMovieKey = (data) => {
    const event = data?.event;
    const md = data?.Metadata || {};
    const itemType = md?.type;
    const ratingKey = md?.ratingKey != null ? String(md.ratingKey) : '';
    if (event !== 'library.new' || itemType !== 'movie' || !ratingKey) return null;
    return { ratingKey, metadata: md };
};
