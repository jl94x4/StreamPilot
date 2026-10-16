import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-hold-'));
process.env.CONFIG_DIR = configDir;

const { upsertScans, listQueue, listHeld, listLog } = await import('./queue.js');
const {
    processOne,
    isTargetUnreachableError,
    resetScannerTargetDownState,
} = await import('./processor.js');

const listen = (server) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve) => {
    server.close(() => resolve());
});

const scannerConfig = {
    minimumAge: '0s',
    targets: {
        plex: [{ enabled: true, usePortalCredentials: true, rewrite: [] }],
    },
    triggers: {},
};

const portalFor = (port) => ({
    mediaServerType: 'plex',
    plexServerUrl: `http://127.0.0.1:${port}`,
    plexToken: 'test-token',
});

test('unreachable errors are the ones that wait for Plex', () => {
    assert.equal(isTargetUnreachableError(Object.assign(new Error('connect ETIMEDOUT 10.0.0.5:32400'), { code: 'ETIMEDOUT' })), true);
    assert.equal(isTargetUnreachableError(new Error('request to http://plex:32400/ failed, reason: connect ECONNREFUSED 10.0.0.5:32400')), true);
    assert.equal(isTargetUnreachableError(new Error('Plex unavailable HTTP 503')), true);
    assert.equal(isTargetUnreachableError(new Error('Plex unavailable HTTP 401')), false);
    assert.equal(isTargetUnreachableError(new Error('Plex scan HTTP 400')), false);
});

test('scans wait while Plex is down and resend when it responds', async () => {
    resetScannerTargetDownState();
    const dead = net.createServer((socket) => socket.destroy());
    const deadPort = await listen(dead);
    const due = {
        folder: '/media/movies/Due (2020)',
        priority: 1,
        time: new Date(Date.now() - 120_000).toISOString(),
        source: 'radarr',
        title: 'Due',
        action: 'import',
        reason: 'Import',
        quality: 'WEBDL-1080p',
    };
    const later = {
        folder: '/media/movies/Later (2021)',
        priority: 1,
        time: new Date(Date.now() + 3_600_000).toISOString(),
        source: 'radarr',
        title: 'Later',
        action: 'import',
        reason: 'Import',
    };

    try {
        await upsertScans([due, later]);
        const first = await processOne(portalFor(deadPort), scannerConfig);
        assert.equal(first.waiting, true);
        assert.deepEqual((await listQueue()).map((scan) => scan.folder), []);
        const held = await listHeld();
        assert.deepEqual(held.map((scan) => scan.folder).sort(), [due.folder, later.folder].sort());
        assert.ok(held.every((scan) => scan.holdReason));

        await upsertScans([{ ...due, title: 'Due (updated)' }]);
        const heldAfterUpdate = await listHeld();
        assert.equal(heldAfterUpdate.find((scan) => scan.folder === due.folder)?.title, 'Due (updated)');
        assert.equal((await listQueue()).length, 0);

        await processOne(portalFor(deadPort), scannerConfig);
        const afterRetry = await listLog(20);
        assert.equal(afterRetry.entries.length, 1);
        assert.equal(afterRetry.entries[0].ok, false);
        assert.equal(afterRetry.entries[0].held, true);

        await close(dead);
        const live = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ MediaContainer: { Directory: [] } }));
        });
        const livePort = await listen(live);
        try {
            resetScannerTargetDownState();
            const resumed = await processOne(portalFor(livePort), scannerConfig);
            assert.equal(resumed.didWork, true);
            assert.equal((await listHeld()).length, 0);
            assert.deepEqual((await listQueue()).map((scan) => scan.folder), [later.folder]);
            const log = await listLog(20);
            assert.equal(log.entries[0].ok, true);
            assert.equal(log.entries[0].folder, due.folder);
            assert.equal(log.entries.filter((entry) => entry.ok === false).length, 1);
        } finally {
            await close(live);
        }
    } finally {
        if (dead.listening) await close(dead);
    }
});
