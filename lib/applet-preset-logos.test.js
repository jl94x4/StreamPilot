import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    APPLET_PRESET_LOGOS,
    appletPresetLogoPath,
    isAppletPresetLogoUrl,
    matchAppletPresetLogo,
    parseAppletPresetLogoUrl,
} from './applet-preset-logos.js';

assert.equal(appletPresetLogoPath('sonarr'), '/static/applets/sonarr.png');
assert.equal(appletPresetLogoPath('sonarr-4k'), '/static/applets/sonarr-4k.png');
assert.equal(appletPresetLogoPath('nginx-proxy-manager'), '/static/applets/nginx-proxy-manager.png');
assert.equal(appletPresetLogoPath('../evil'), '');
assert.equal(appletPresetLogoPath('missing-service'), '');
assert.equal(parseAppletPresetLogoUrl('/static/applets/radarr.png'), 'radarr');
assert.equal(parseAppletPresetLogoUrl('/static/applets/radarr-4k.png'), 'radarr-4k');
assert.equal(parseAppletPresetLogoUrl('/static/applets/rdt-client.png'), 'rdt-client');
assert.equal(isAppletPresetLogoUrl('/static/applets/radarr.png?v=1'), true);
assert.equal(isAppletPresetLogoUrl('/static/applets/../logo.png'), false);
assert.equal(isAppletPresetLogoUrl('/api/branding/custom-tab/abc'), false);

assert.equal(matchAppletPresetLogo('Radarr', '').id, 'radarr');
assert.equal(matchAppletPresetLogo('Sonarr', '').id, 'sonarr');
assert.equal(matchAppletPresetLogo('Sonarr 4K', '').id, 'sonarr-4k');
assert.equal(matchAppletPresetLogo('Radarr 4K', '').id, 'radarr-4k');
assert.equal(matchAppletPresetLogo('4K Sonarr', '').id, 'sonarr-4k');
assert.equal(matchAppletPresetLogo('Movies 4K', 'https://radarr-4k.example.com').id, 'radarr-4k');
assert.equal(matchAppletPresetLogo('Photos', 'https://immich.example.com').id, 'immich');
assert.equal(matchAppletPresetLogo('BitTorrent', '').id, 'qbittorrent');
assert.equal(matchAppletPresetLogo('Vaultwarden', 'https://vault.example.com').id, 'vaultwarden');
assert.equal(matchAppletPresetLogo('Bitwarden', '').id, 'bitwarden');
assert.equal(matchAppletPresetLogo('Jellyseerr', 'https://overseerr.example.com').id, 'jellyseerr');
assert.equal(matchAppletPresetLogo('Ombi', '').id, 'ombi');
assert.equal(matchAppletPresetLogo('RDT Client', '').id, 'rdt-client');
assert.equal(matchAppletPresetLogo('NPM', 'https://nginx-proxy-manager.example.com').id, 'nginx-proxy-manager');
assert.equal(matchAppletPresetLogo('Pi-hole', '').id, 'pi-hole');
assert.equal(matchAppletPresetLogo('Home Assistant', '').id, 'home-assistant');
assert.equal(matchAppletPresetLogo('Portainer', '').id, 'portainer');
assert.equal(matchAppletPresetLogo('Games', 'https://games.example.com'), null);

const appletsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static/applets');
for (const entry of APPLET_PRESET_LOGOS) {
    const filePath = path.join(appletsDir, `${entry.id}.png`);
    assert.equal(fs.existsSync(filePath), true, `missing logo ${entry.id}.png`);
}

console.log('applet preset logos ok');
