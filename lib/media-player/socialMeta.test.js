import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildMediaPlayerOgImageUrl,
    buildSocialMetaTagBlock,
    formatMediaPlayerSocialDescription,
    formatMediaPlayerSocialTitle,
    ogTypeForMedia,
    parseMediaPlayerSocialTarget,
    pickMediaPlayerSocialImagePath,
    socialPreviewFromPlexMetadata,
} from './socialMeta.js';

test('parseMediaPlayerSocialTarget reads item, playlist, collection, and library paths', () => {
    assert.deepEqual(parseMediaPlayerSocialTarget('/media-player/item/813130'), {
        kind: 'item',
        ratingKey: '813130',
    });
    assert.deepEqual(parseMediaPlayerSocialTarget('/media-player/playlist/9'), {
        kind: 'playlist',
        ratingKey: '9',
    });
    assert.deepEqual(parseMediaPlayerSocialTarget('/media-player/library/2/collection/55'), {
        kind: 'collection',
        ratingKey: '55',
        sectionKey: '2',
    });
    assert.deepEqual(parseMediaPlayerSocialTarget('/media-player/library/1/browse'), {
        kind: 'library',
        sectionKey: '1',
    });
    assert.equal(parseMediaPlayerSocialTarget('/discover'), null);
});

test('formatMediaPlayerSocialTitle includes year and episode codes', () => {
    assert.equal(
        formatMediaPlayerSocialTitle({ type: 'movie', title: 'Heat', year: 1995 }, 'SubZero'),
        'Heat (1995) · SubZero',
    );
    assert.match(
        formatMediaPlayerSocialTitle({
            type: 'episode',
            title: 'Tripping',
            grandparentTitle: "Clarkson's Farm",
            parentIndex: 1,
            index: 3,
        }, 'SubZero'),
        /Clarkson's Farm — S1E3 · Tripping · SubZero/,
    );
});

test('pickMediaPlayerSocialImagePath prefers posters over backdrop art', () => {
    assert.equal(pickMediaPlayerSocialImagePath({
        art: '/library/metadata/1/art/2',
        thumb: '/library/metadata/1/thumb/3',
    }), '/library/metadata/1/thumb/3');
    assert.equal(pickMediaPlayerSocialImagePath({
        type: 'episode',
        thumb: '/library/metadata/9/thumb/ep',
        grandparentThumb: '/library/metadata/1/thumb/show',
        art: '/library/metadata/1/art/2',
    }), '/library/metadata/1/thumb/show');
    assert.equal(pickMediaPlayerSocialImagePath({
        thumb: 'https://evil.example/x',
    }), '');
});

test('socialPreviewFromPlexMetadata builds OG fields and a public poster URL', () => {
    const preview = socialPreviewFromPlexMetadata({
        MediaContainer: {
            Metadata: [{
                ratingKey: '813130',
                type: 'movie',
                title: 'Heat',
                year: 1995,
                summary: 'A group of professional bank robbers start to feel the heat.',
                art: '/library/metadata/813130/art/1',
                thumb: '/library/metadata/813130/thumb/1',
            }],
        },
    }, {
        serverName: 'SubZero',
        baseUrl: 'https://portal.example',
        pageUrl: 'https://portal.example/media-player/item/813130',
        ratingKey: '813130',
    });
    assert.equal(preview.title, 'Heat (1995) · SubZero');
    assert.match(preview.description, /bank robbers/);
    assert.equal(preview.type, 'video.movie');
    assert.equal(preview.card, 'summary');
    assert.equal(preview.imageWidth, 600);
    assert.equal(preview.imageHeight, 900);
    assert.equal(
        preview.imageUrl,
        'https://portal.example/api/public/media-player/og-image/813130?width=600&height=900&kind=poster',
    );
});

test('buildSocialMetaTagBlock emits Open Graph and Twitter tags', () => {
    const html = buildSocialMetaTagBlock({
        title: 'Heat (1995) · SubZero',
        description: 'A heist classic.',
        pageUrl: 'https://portal.example/media-player/item/813130',
        imageUrl: 'https://portal.example/api/public/media-player/og-image/813130?width=600&height=900&kind=poster',
        siteName: 'SubZero',
        type: 'video.movie',
        imageWidth: 600,
        imageHeight: 900,
        card: 'summary',
    });
    assert.match(html, /property="og:title"/);
    assert.match(html, /property="og:image"/);
    assert.match(html, /property="og:image:secure_url"/);
    assert.match(html, /name="twitter:card" content="summary"/);
    assert.match(html, /name="twitter:image"/);
    assert.equal(ogTypeForMedia('show'), 'video.tv_show');
    assert.equal(
        buildMediaPlayerOgImageUrl('https://x/', '12'),
        'https://x/api/public/media-player/og-image/12?width=600&height=900&kind=poster',
    );
    assert.equal(formatMediaPlayerSocialDescription({ type: 'movie' }), 'Watch this movie in Media Player.');
});
