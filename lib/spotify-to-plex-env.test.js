import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { syncSpotifyToPlexSidecarEnv } from './spotify-to-plex-env.js';

const readyConfig = {
    spotifyToPlexEnabled: true,
    spotifyToPlexClientId: 'id',
    spotifyToPlexClientSecret: 'secret',
    spotifyToPlexEncryptionKey: 'key',
};

test('syncSpotifyToPlexSidecarEnv does not rewrite an unchanged env file', async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stp-env-'));
    try {
        const first = await syncSpotifyToPlexSidecarEnv(readyConfig, {
            configDir,
            resolveSpotifyToPlexCallbackUrl: () => 'https://portal.example/callback',
        });
        assert.equal(first.written, true);
        const second = await syncSpotifyToPlexSidecarEnv(readyConfig, {
            configDir,
            resolveSpotifyToPlexCallbackUrl: () => 'https://portal.example/callback',
        });
        assert.equal(second.written, false);
        assert.equal(second.unchanged, true);
    } finally {
        await fs.rm(configDir, { recursive: true, force: true });
    }
});
