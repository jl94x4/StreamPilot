import assert from 'node:assert/strict';
import test from 'node:test';
import { isLanHttpImage, resolveLanImages } from './lanImage.ts';

test('isLanHttpImage is true only for http:// artwork', () => {
    assert.equal(isLanHttpImage('http://192.168.1.40:8001/api/img'), true);
    assert.equal(isLanHttpImage('https://plex.tv/photo'), false);
    assert.equal(isLanHttpImage('blob:https://app/1'), false);
    assert.equal(isLanHttpImage('/library/metadata/1/thumb'), false);
    assert.equal(isLanHttpImage(''), false);
    assert.equal(isLanHttpImage(null), false);
});

test('resolveLanImages swaps http thumbs for blob URLs and leaves https alone', async () => {
    const previous = globalThis.fetch;
    const previousCreate = URL.createObjectURL;
    globalThis.fetch = async (url) => {
        assert.equal(url, 'http://tuner/art.jpg');
        return {
            ok: true,
            blob: async () => new Blob(['x'], { type: 'image/jpeg' }),
        };
    };
    URL.createObjectURL = () => 'blob:test-lan';
    try {
        const [lan, https] = await resolveLanImages([
            { thumb: 'http://tuner/art.jpg', art: 'https://keep.example/art' },
            { thumb: '/library/metadata/1/thumb', art: null },
        ]);
        assert.equal(lan.thumb, 'blob:test-lan');
        assert.equal(lan.art, 'https://keep.example/art');
        assert.equal(https.thumb, '/library/metadata/1/thumb');
        assert.equal(https.art, null);
    } finally {
        globalThis.fetch = previous;
        URL.createObjectURL = previousCreate;
    }
});

test('resolveLanImages keeps the http URL when the LAN fetch fails', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, blob: async () => new Blob([]) });
    try {
        const [row] = await resolveLanImages([{ thumb: 'http://tuner/missing.jpg', art: null }]);
        assert.equal(row.thumb, 'http://tuner/missing.jpg');
    } finally {
        globalThis.fetch = previous;
    }
});
