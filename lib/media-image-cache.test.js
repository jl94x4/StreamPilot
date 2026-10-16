import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    collectDashboardImageJobs,
    getCachedMediaImage,
    getOrFetchMediaImage,
    mediaImageCacheKey,
    pruneMediaImageCache,
    putCachedMediaImage,
    resetMediaImageCacheStateForTests,
    withMediaImageInflight,
    withMediaImageUpstreamSlot,
} from './media-image-cache.js';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01, 0x02, 0x03]);

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'media-image-cache-'));
const cacheDir = path.join(tmpRoot, 'media-image-cache');

resetMediaImageCacheStateForTests();

assert.equal(
    mediaImageCacheKey({ source: 'plex', id: '/library/metadata/1/thumb', width: 300, height: 450 }),
    mediaImageCacheKey({ source: 'plex', id: '/library/metadata/1/thumb', width: 300, height: 450 }),
);
assert.notEqual(
    mediaImageCacheKey({ source: 'plex', id: '/library/metadata/1/thumb', width: 300, height: 450 }),
    mediaImageCacheKey({ source: 'jellyfin', id: '/library/metadata/1/thumb', width: 300, height: 450 }),
);

const key = mediaImageCacheKey({ source: 'plex', id: '/library/metadata/9/thumb', width: 300, height: 450 });
assert.equal(await getCachedMediaImage(key, { cacheDir }), null);

const stored = await putCachedMediaImage(key, { contentType: 'image/jpeg', body: jpeg }, { cacheDir });
assert.equal(stored, true);
resetMediaImageCacheStateForTests();
const hit = await getCachedMediaImage(key, { cacheDir });
assert.equal(hit.contentType, 'image/jpeg');
assert.equal(Buffer.compare(hit.body, jpeg), 0);

assert.equal(await putCachedMediaImage(key, { contentType: 'image/jpeg', body: Buffer.alloc(0) }, { cacheDir }), false);

const expired = await getCachedMediaImage(key, { cacheDir, now: Date.now() + 8 * 24 * 60 * 60 * 1000 });
assert.equal(expired, null);

const jobs = collectDashboardImageJobs({
    source: 'plex',
    recentMovies: [{ thumb: '/library/metadata/1/thumb' }, { thumb: '/library/metadata/1/thumb' }],
    recentShows: [{ thumb: '/library/metadata/2/thumb' }],
    recentMusic: [{ thumb: '/library/metadata/3/thumb' }, { thumb: '' }],
});
assert.equal(jobs.length, 3);
assert.deepEqual(jobs[0], { source: 'plex', id: '/library/metadata/1/thumb', width: 300, height: 450 });
assert.deepEqual(jobs[2], { source: 'plex', id: '/library/metadata/3/thumb', width: 300, height: 300 });

let fetches = 0;
const inflightKey = mediaImageCacheKey({ source: 'plex', id: '/library/metadata/inflight/thumb', width: 300, height: 450 });
const slowFetch = () => new Promise((resolve) => {
    fetches += 1;
    setTimeout(() => resolve({ contentType: 'image/jpeg', body: jpeg }), 30);
});
const [a, b] = await Promise.all([
    getOrFetchMediaImage(inflightKey, slowFetch, { cacheDir }),
    getOrFetchMediaImage(inflightKey, slowFetch, { cacheDir }),
]);
assert.equal(fetches, 1);
assert.equal(a.cacheStatus === 'miss' || b.cacheStatus === 'miss', true);
assert.equal(a.body.length, jpeg.length);
assert.equal(b.body.length, jpeg.length);

let sharedRuns = 0;
const shared = withMediaImageInflight('same', async () => {
    sharedRuns += 1;
    return 'ok';
});
const sharedAgain = withMediaImageInflight('same', async () => {
    sharedRuns += 1;
    return 'nope';
});
assert.equal(await shared, 'ok');
assert.equal(await sharedAgain, 'ok');
assert.equal(sharedRuns, 1);

resetMediaImageCacheStateForTests();
const slotOrder = [];
let releaseBlock = () => {};
const blocked = withMediaImageUpstreamSlot(
    () => new Promise((resolve) => {
        slotOrder.push('block');
        releaseBlock = resolve;
    }),
    { max: 1, priority: 'live' },
);
const warmSlot = withMediaImageUpstreamSlot(
    () => {
        slotOrder.push('warm');
        return Promise.resolve();
    },
    { max: 1, priority: 'low' },
);
const liveSlot = withMediaImageUpstreamSlot(
    () => {
        slotOrder.push('live');
        return Promise.resolve();
    },
    { max: 1, priority: 'live' },
);
await Promise.resolve();
assert.deepEqual(slotOrder, ['block']);
releaseBlock();
await Promise.all([blocked, warmSlot, liveSlot]);
assert.deepEqual(slotOrder, ['block', 'live', 'warm']);

const pruneDir = path.join(tmpRoot, 'prune');
await fs.mkdir(pruneDir, { recursive: true });
for (let i = 0; i < 4; i += 1) {
    const pruneKey = mediaImageCacheKey({ source: 'plex', id: `/library/metadata/${i}/thumb`, width: 300, height: 450 });
    await putCachedMediaImage(pruneKey, { contentType: 'image/jpeg', body: jpeg }, { cacheDir: pruneDir, now: 1_000 + i });
}
const pruned = await pruneMediaImageCache({
    cacheDir: pruneDir,
    now: 2_000,
    ttlMs: 60 * 60 * 1000,
    maxFiles: 2,
    maxBytes: 10 * 1024 * 1024,
});
assert.equal(pruned.removed, 2);
const leftover = (await fs.readdir(pruneDir)).filter((name) => name.endsWith('.bin'));
assert.equal(leftover.length, 2);

await fs.rm(tmpRoot, { recursive: true, force: true });
console.log('media-image-cache ok');
