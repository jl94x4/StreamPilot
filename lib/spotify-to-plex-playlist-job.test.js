import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpotifyPlaylistSyncJobStore } from './spotify-to-plex-playlist-job.js';

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test('start runs the sync in the background and records progress', async () => {
    const store = createSpotifyPlaylistSyncJobStore({ now: () => 1000 });
    const started = store.start({
        ids: ['pl1'],
        run: async ({ onProgress }) => {
            onProgress({ message: 'Matching tracks in Plex (4/10)…', done: 4, total: 10 });
            await wait(20);
            return { ok: true, message: 'Created “Hits” on Plex (8/10 tracks).' };
        },
    });
    assert.equal(started.status, 'running');
    assert.equal(store.snapshot().status, 'running');
    await wait(40);
    const done = store.snapshot();
    assert.equal(done.status, 'success');
    assert.match(done.message, /Created/);
    assert.equal(done.done, 4);
    assert.equal(done.total, 10);
});

test('start rejects a second job while one is running', async () => {
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const store = createSpotifyPlaylistSyncJobStore();
    store.start({
        ids: ['pl1'],
        run: () => blocked.then(() => ({ ok: true, message: 'done' })),
    });
    assert.throws(() => store.start({ ids: ['pl2'], run: async () => ({ ok: true }) }), (error) => {
        assert.equal(error.status, 409);
        return /already running/i.test(error.message);
    });
    release({ ok: true, message: 'done' });
    await wait(20);
    const next = store.start({ ids: ['pl2'], run: async () => ({ ok: true, message: 'ok' }) });
    assert.equal(next.status, 'running');
    await wait(20);
    assert.equal(store.snapshot().status, 'success');
});

test('completed jobs stay in history for the logs view', async () => {
    const store = createSpotifyPlaylistSyncJobStore({ now: () => 2000 });
    store.start({
        ids: ['pl1'],
        run: async () => ({ ok: true, message: 'Created Hits' }),
    });
    await wait(20);
    const history = store.listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].message, 'Created Hits');
    store.start({
        ids: ['pl2'],
        run: async () => ({ ok: true, message: 'Created Mix' }),
    });
    await wait(20);
    assert.equal(store.listHistory().length, 2);
    assert.equal(store.listHistory()[0].message, 'Created Mix');
    store.clearHistory();
    assert.equal(store.listHistory().length, 0);
});
