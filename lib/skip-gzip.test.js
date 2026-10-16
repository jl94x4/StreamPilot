import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSkipGzipForUrl } from './skip-gzip.js';

test('shouldSkipGzipForUrl skips streamed images and fat JSON APIs', () => {
    assert.equal(shouldSkipGzipForUrl('/api/plex/image?path=/library/metadata/1/thumb'), true);
    assert.equal(shouldSkipGzipForUrl('/api/jellyfin/image?itemId=abc'), true);
    assert.equal(shouldSkipGzipForUrl('/api/plex/analytics/me?days=365'), true);
    assert.equal(shouldSkipGzipForUrl('/api/achievements/me'), true);
    assert.equal(shouldSkipGzipForUrl('/api/collexions/collections'), true);
    assert.equal(shouldSkipGzipForUrl('/api/speedtest/download'), true);
    assert.equal(shouldSkipGzipForUrl('/api/poster-sets/watches/c412b5a1-a29b-4b3f-8144-4288ffca0b24'), true);
    assert.equal(shouldSkipGzipForUrl('/api/poster-sets/watch/c412b5a1-a29b-4b3f-8144-4288ffca0b24'), true);
    assert.equal(shouldSkipGzipForUrl('/api/media-player/file/12?hevc=1'), true);
    assert.equal(shouldSkipGzipForUrl('/api/media-player/hls/12/master.m3u8'), true);
    assert.equal(shouldSkipGzipForUrl('/api/media-player/proxy?u=http%3A%2F%2Fplex'), true);
    assert.equal(shouldSkipGzipForUrl('/api/media-player/theme/99'), true);
    assert.equal(shouldSkipGzipForUrl('/api/media-player/play/12'), false);
});

test('shouldSkipGzipForUrl still compresses normal pages and small APIs', () => {
    assert.equal(shouldSkipGzipForUrl('/'), false);
    assert.equal(shouldSkipGzipForUrl('/api/config/public'), false);
    assert.equal(shouldSkipGzipForUrl('/static/index.js'), false);
});
