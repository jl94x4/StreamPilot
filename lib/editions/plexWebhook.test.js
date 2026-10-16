import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import test from 'node:test';
import {
    editionsWebhookMovieKey,
    extractMultipartFormField,
    parseWebhookJson,
    resolvePlexWebhookPayload,
} from './plexWebhook.js';

const plexEvent = {
    event: 'library.new',
    Metadata: { type: 'movie', ratingKey: '42', title: 'Heat', addedAt: 1_700_000_000 },
};

test('extractMultipartFormField reads the Plex payload part and ignores thumb', () => {
    const boundary = '----plex-boundary';
    const json = JSON.stringify(plexEvent);
    const body = Buffer.from(
        `------plex-boundary\r\n`
        + 'Content-Disposition: form-data; name="payload"\r\n'
        + 'Content-Type: application/json\r\n'
        + '\r\n'
        + `${json}\r\n`
        + `------plex-boundary\r\n`
        + 'Content-Disposition: form-data; name="thumb"; filename="thumb.jpg"\r\n'
        + 'Content-Type: image/jpeg\r\n'
        + '\r\n'
        + 'not-a-real-jpeg\r\n'
        + `------plex-boundary--\r\n`,
    );
    const field = extractMultipartFormField(body, `multipart/form-data; boundary=${boundary}`, 'payload');
    assert.equal(field, json);
    assert.deepEqual(JSON.parse(field), plexEvent);
});

test('editionsWebhookMovieKey only accepts fresh library.new movies', () => {
    assert.equal(editionsWebhookMovieKey({ event: 'media.play', Metadata: plexEvent.Metadata }), null);
    assert.equal(editionsWebhookMovieKey({ event: 'library.new', Metadata: { type: 'episode', ratingKey: '1' } }), null);
    assert.deepEqual(editionsWebhookMovieKey(plexEvent), {
        ratingKey: '42',
        metadata: plexEvent.Metadata,
    });
});

test('resolvePlexWebhookPayload accepts JSON and urlencoded payload', async () => {
    const jsonReq = { body: plexEvent, headers: { 'content-type': 'application/json' } };
    assert.deepEqual(await resolvePlexWebhookPayload(jsonReq), plexEvent);

    const formReq = { body: { payload: JSON.stringify(plexEvent) }, headers: { 'content-type': 'application/x-www-form-urlencoded' } };
    assert.deepEqual(await resolvePlexWebhookPayload(formReq), plexEvent);
});

test('resolvePlexWebhookPayload reads unread multipart streams', async () => {
    const boundary = '----plex-boundary';
    const json = JSON.stringify(plexEvent);
    const raw = Buffer.from(
        `------plex-boundary\r\n`
        + 'Content-Disposition: form-data; name="payload"\r\n'
        + '\r\n'
        + `${json}\r\n`
        + `------plex-boundary--\r\n`,
    );
    const req = new EventEmitter();
    req.body = {};
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.readableEnded = false;
    req.readable = true;
    const pending = resolvePlexWebhookPayload(req);
    queueMicrotask(() => {
        req.emit('data', raw);
        req.emit('end');
    });
    assert.deepEqual(await pending, plexEvent);
});

test('parseWebhookJson round-trips objects and strings', () => {
    assert.deepEqual(parseWebhookJson(plexEvent), plexEvent);
    assert.deepEqual(parseWebhookJson(JSON.stringify(plexEvent)), plexEvent);
    assert.equal(parseWebhookJson(''), null);
});
