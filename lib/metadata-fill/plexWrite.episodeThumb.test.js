import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlexMetadataClient } from './plexWrite.js';
import { mergeEpisodeMetadata } from './sources.js';

const STILL = 'https://image.tmdb.org/t/p/original/still.jpg';

const makeClient = (posters, calls) => createPlexMetadataClient({
    baseUrl: 'http://plex.local:32400',
    token: 'tok',
    fetchImpl: async (url, opts = {}) => {
        const method = String(opts.method || 'GET');
        calls.push({ url: String(url), method });
        if (String(url).includes('/posters') && method === 'GET') {
            return {
                ok: true,
                status: 200,
                json: async () => ({ MediaContainer: { Metadata: posters } }),
                text: async () => '',
            };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    },
});

test('applyEpisodeThumbFromUrl uploads by URL and locks when only a video frame exists', async () => {
    const calls = [];
    const client = makeClient([{ ratingKey: 'media://frame', provider: '', selected: true }], calls);
    const result = await client.applyEpisodeThumbFromUrl('12', STILL, { metadata: { ratingKey: '12' } });
    assert.equal(result.uploaded, true);
    const post = calls.find((c) => c.method === 'POST');
    assert.match(post.url, /\/library\/metadata\/12\/posters\?url=/);
    assert.ok(post.url.includes(encodeURIComponent(STILL)));
    assert.ok(calls.some((c) => c.method === 'PUT' && /thumb\.locked=1/.test(c.url)));
});

test('applyEpisodeThumbFromUrl skips when an agent title card exists', async () => {
    const calls = [];
    const client = makeClient([{ ratingKey: 'metadata://x', provider: 'tv.plex.agents.series' }], calls);
    const result = await client.applyEpisodeThumbFromUrl('12', STILL, { metadata: { ratingKey: '12' } });
    assert.equal(result.reason, 'has-title-card');
    assert.ok(!calls.some((c) => c.method === 'POST'));
});

test('applyEpisodeThumbFromUrl skips when the thumb is locked', async () => {
    const calls = [];
    const client = makeClient([], calls);
    const result = await client.applyEpisodeThumbFromUrl('12', STILL, {
        metadata: { ratingKey: '12', Field: [{ name: 'thumb', locked: true }] },
    });
    assert.equal(result.reason, 'thumb-locked');
    assert.ok(!calls.some((c) => c.method === 'POST'));
});

test('applyEpisodeThumbFromUrl dry-run reports without writing', async () => {
    const calls = [];
    const client = makeClient([], calls);
    const result = await client.applyEpisodeThumbFromUrl('12', STILL, { metadata: { ratingKey: '12' }, dryRun: true });
    assert.equal(result.wouldUpload, true);
    assert.ok(!calls.some((c) => c.method !== 'GET'));
});

test('mergeEpisodeMetadata picks thumbUrl in source preference order', () => {
    const tmdb = { title: 'A', still: 'https://tmdb/still.jpg' };
    const tvdb = { title: 'A', still: 'https://tvdb/still.jpg' };
    assert.equal(mergeEpisodeMetadata(tmdb, tvdb, null).thumbUrl, 'https://tmdb/still.jpg');
    assert.equal(mergeEpisodeMetadata(tmdb, tvdb, null, { prefer: 'tvdb' }).thumbUrl, 'https://tvdb/still.jpg');
    assert.equal(mergeEpisodeMetadata({ title: 'A' }, null, { still: 'https://maze/x.jpg' }).thumbUrl, 'https://maze/x.jpg');
    assert.equal(mergeEpisodeMetadata({ title: 'A' }, null, null).thumbUrl, null);
});
