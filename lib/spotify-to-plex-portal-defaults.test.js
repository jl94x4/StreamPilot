import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import {
    getSpotifyToPlexPlexConfigPath,
    syncSpotifyToPlexPlexConfigFile,
} from './spotify-to-plex-portal-defaults.js';

test('syncSpotifyToPlexPlexConfigFile writes portal Plex URL and token', () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stp-portal-'));
    const result = syncSpotifyToPlexPlexConfigFile({
        spotifyToPlexEnabled: true,
        plexServerUrl: 'http://plex.local:32400',
        plexToken: 'portal-token',
        serverIdentifier: 'server-guid',
    }, {
        configDir,
        resolveConfiguredPlexServerUrl: (cfg) => cfg.plexServerUrl,
    });

    assert.equal(result.written, true);
    const filePath = getSpotifyToPlexPlexConfigPath(configDir);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(parsed.uri, 'http://plex.local:32400');
    assert.equal(parsed.serverToken, 'portal-token');
    assert.equal(parsed.token, 'portal-token');
    assert.equal(parsed.id, 'server-guid');
    fs.rmSync(configDir, { recursive: true, force: true });
});
