import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import {
    PROXY_IMAGE_MAX_BYTES,
    bufferFetchImage,
    discardFetchBody,
    pipeFetchBodyToResponse,
    sendFetchImage,
    sendImageBuffer,
} from './fetch-body.js';

test('discardFetchBody cancels a web stream body', async () => {
    let cancelled = false;
    const body = {
        cancel: async () => {
            cancelled = true;
        },
    };
    discardFetchBody({ bodyUsed: false, body });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled, true);
});

test('discardFetchBody is a no-op when the body was already used', () => {
    let cancelled = false;
    discardFetchBody({
        bodyUsed: true,
        body: {
            cancel: () => {
                cancelled = true;
            },
        },
    });
    assert.equal(cancelled, false);
});

test('pipeFetchBodyToResponse streams a node body without buffering the whole payload', async () => {
    const source = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
    const dest = new PassThrough();
    const chunks = [];
    dest.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise((resolve, reject) => {
        dest.on('finish', resolve);
        dest.on('error', reject);
    });
    await pipeFetchBodyToResponse({ body: source }, dest, { maxBytes: 64 });
    await done;
    assert.equal(Buffer.concat(chunks).toString(), 'abcdef');
});

test('pipeFetchBodyToResponse aborts when the body exceeds maxBytes', async () => {
    const source = Readable.from([Buffer.alloc(32, 1), Buffer.alloc(32, 2)]);
    const dest = new PassThrough();
    dest.resume();
    await assert.rejects(
        () => pipeFetchBodyToResponse({ body: source }, dest, { maxBytes: 40 }),
        (error) => error.code === 'FETCH_BODY_TOO_LARGE',
    );
});

test('sendFetchImage discards non-ok responses and does not pipe them', async () => {
    let cancelled = false;
    const res = {
        headersSent: false,
        statusCode: 200,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
        setHeader() {},
    };
    const ok = await sendFetchImage(res, {
        ok: false,
        status: 404,
        bodyUsed: false,
        body: {
            cancel: async () => {
                cancelled = true;
            },
        },
        headers: { get: () => 'image/jpeg' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ok, false);
    assert.equal(res.statusCode, 404);
    assert.equal(cancelled, true);
});

test('PROXY_IMAGE_MAX_BYTES stays at 8MB', () => {
    assert.equal(PROXY_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
});

test('bufferFetchImage returns null for non-ok responses', async () => {
    let cancelled = false;
    const buffered = await bufferFetchImage({
        ok: false,
        status: 500,
        bodyUsed: false,
        body: {
            cancel: async () => {
                cancelled = true;
            },
        },
        headers: { get: () => 'image/jpeg' },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(buffered, null);
    assert.equal(cancelled, true);
});

test('bufferFetchImage keeps a jpeg body', async () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const buffered = await bufferFetchImage({
        ok: true,
        arrayBuffer: async () => payload,
        headers: { get: (name) => (name === 'content-type' ? 'image/jpeg' : null) },
    });
    assert.equal(buffered.contentType, 'image/jpeg');
    assert.equal(Buffer.compare(buffered.body, payload), 0);
});

test('sendImageBuffer writes cache headers', () => {
    const headers = {};
    const res = {
        headersSent: false,
        setHeader(name, value) {
            headers[name] = value;
        },
        send(body) {
            this.body = body;
            return this;
        },
        status() {
            return this;
        },
    };
    const ok = sendImageBuffer(res, { contentType: 'image/jpeg', body: Buffer.from('abc') }, { cacheStatus: 'hit' });
    assert.equal(ok, true);
    assert.equal(headers['Content-Type'], 'image/jpeg');
    assert.equal(headers['X-Media-Image-Cache'], 'hit');
    assert.equal(headers['Cache-Control'], 'private, max-age=604800, stale-while-revalidate=604800');
});
