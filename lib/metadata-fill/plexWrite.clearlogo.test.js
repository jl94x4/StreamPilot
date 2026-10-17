import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlexMetadataClient } from './plexWrite.js';

test('selectClearLogo builds PUT .../clearLogo?url= and unlocks first', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        calls.push({ url: String(url), method: String(opts.method || 'GET') });
        return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({}),
        };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    await client.selectClearLogo('12345', 'metadata://agent/logo-1', { type: 'movie', unlock: true });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'PUT');
    assert.match(calls[0].url, /\/library\/metadata\/12345\?/);
    assert.match(calls[0].url, /clearLogo\.locked=0/);
    assert.equal(calls[1].method, 'PUT');
    assert.match(calls[1].url, /\/library\/metadata\/12345\/clearLogo\?url=/);
    assert.match(calls[1].url, /url=metadata%3A%2F%2Fagent%2Flogo-1/);
});

test('listClearLogos hits GET .../clearLogos', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({
                MediaContainer: {
                    Metadata: [
                        { ratingKey: 'metadata://a', provider: 'com.plexapp.agents.themoviedb', selected: false },
                    ],
                },
            }),
            text: async () => '',
        };
    };
    const client = createPlexMetadataClient({
        baseUrl: 'http://plex.local:32400',
        token: 'tok',
        fetchImpl,
    });
    const rows = await client.listClearLogos('99');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ratingKey, 'metadata://a');
    assert.match(calls[0], /\/library\/metadata\/99\/clearLogos/);
});
