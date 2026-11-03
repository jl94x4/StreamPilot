import assert from 'node:assert/strict';
import test from 'node:test';
import {
    downloadPngClearLogo,
    isPngBuffer,
    isPngFilePath,
    pickBestTmdbPngLogo,
    resolveExternalPngClearLogo,
    tmdbIdFromPlexMeta,
    tmdbOriginalImageUrl,
} from './clearlogoExternal.js';

const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

test('isPngFilePath accepts only .png paths', () => {
    assert.equal(isPngFilePath('/abc/logo.png'), true);
    assert.equal(isPngFilePath('/abc/logo.PNG'), true);
    assert.equal(isPngFilePath('/abc/logo.svg'), false);
    assert.equal(isPngFilePath('/abc/logo.jpg'), false);
    assert.equal(isPngFilePath(''), false);
});

test('isPngBuffer checks magic bytes', () => {
    assert.equal(isPngBuffer(PNG_BYTES), true);
    assert.equal(isPngBuffer(Buffer.from('not-png')), false);
    assert.equal(isPngBuffer(Buffer.from([0xff, 0xd8, 0xff])), false);
});

test('pickBestTmdbPngLogo prefers English PNG and rejects SVG/JPG', () => {
    const best = pickBestTmdbPngLogo([
        { file_path: '/x/logo.svg', iso_639_1: 'en', vote_average: 9 },
        { file_path: '/x/logo.jpg', iso_639_1: 'en', vote_average: 8 },
        { file_path: '/x/fr.png', iso_639_1: 'fr', vote_average: 7 },
        { file_path: '/x/en.png', iso_639_1: 'en', vote_average: 5 },
        { file_path: '/x/null.png', iso_639_1: null, vote_average: 6 },
    ]);
    assert.ok(best);
    assert.equal(best.filePath, '/x/en.png');
    assert.equal(best.url, 'https://image.tmdb.org/t/p/original/x/en.png');
    assert.equal(best.source, 'tmdb');
});

test('pickBestTmdbPngLogo returns null when no PNG logos', () => {
    assert.equal(pickBestTmdbPngLogo([
        { file_path: '/x/logo.svg', iso_639_1: 'en' },
        { file_path: '/x/logo.webp', iso_639_1: 'en' },
    ]), null);
});

test('tmdbIdFromPlexMeta reads Guid list', () => {
    assert.equal(tmdbIdFromPlexMeta({
        Guid: [{ id: 'imdb://tt1' }, { id: 'tmdb://12345' }],
    }), '12345');
    assert.equal(tmdbIdFromPlexMeta({ guid: 'themoviedb://99' }), '99');
    assert.equal(tmdbIdFromPlexMeta({}), null);
});

test('tmdbOriginalImageUrl builds absolute URLs', () => {
    assert.equal(tmdbOriginalImageUrl('/a/b.png'), 'https://image.tmdb.org/t/p/original/a/b.png');
    assert.equal(tmdbOriginalImageUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
});

test('downloadPngClearLogo accepts PNG and rejects non-PNG', async () => {
    const ok = await downloadPngClearLogo('https://image.tmdb.org/t/p/original/x.png', {
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            headers: { get: () => 'image/png' },
            arrayBuffer: async () => PNG_BYTES.buffer.slice(
                PNG_BYTES.byteOffset,
                PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
            ),
        }),
    });
    assert.equal(ok.contentType, 'image/png');
    assert.ok(ok.buffer.length > 0);

    await assert.rejects(
        () => downloadPngClearLogo('https://image.tmdb.org/t/p/original/x.svg', {
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                headers: { get: () => 'image/svg+xml' },
                arrayBuffer: async () => Buffer.from('<svg/>'),
            }),
        }),
        /not PNG|not a valid PNG/i,
    );
});

test('resolveExternalPngClearLogo returns null without tmdb id', async () => {
    const result = await resolveExternalPngClearLogo({
        metadata: { title: 'No Guid' },
        type: 'movie',
        tmdbApiKey: 'key',
        tmdbClient: { images: async () => ({ logos: [] }) },
    });
    assert.equal(result, null);
});

test('resolveExternalPngClearLogo picks TMDB PNG logo', async () => {
    const result = await resolveExternalPngClearLogo({
        metadata: { Guid: [{ id: 'tmdb://42' }] },
        type: 'show',
        tmdbApiKey: 'key',
        tmdbClient: {
            images: async (mediaType, id) => {
                assert.equal(mediaType, 'tv');
                assert.equal(String(id), '42');
                return {
                    logos: [
                        { file_path: '/logo.svg', iso_639_1: 'en', vote_average: 9 },
                        { file_path: '/logo.png', iso_639_1: 'en', vote_average: 4 },
                    ],
                };
            },
        },
    });
    assert.ok(result);
    assert.equal(result.filePath, '/logo.png');
    assert.equal(result.tmdbId, '42');
    assert.equal(result.mediaType, 'tv');
});
