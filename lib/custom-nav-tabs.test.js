import assert from 'node:assert/strict';
import {
    customNavTabKey,
    isCustomNavTabKey,
    normalizeCustomNavDisplay,
    normalizeCustomNavTabs,
    normalizeLogoUrl,
    parseCustomNavTabKey,
    pruneNavOrderCustomKeys,
    buildDesktopNavOrder,
    APPLETS_NAV_KEY,
} from './custom-nav-tabs.js';

const tabs = normalizeCustomNavTabs([
    {
        id: 'games',
        name: 'Games',
        url: 'https://games.example.com',
        icon: 'Gamepad2',
        openMode: 'embed',
        adminOnly: true,
        enabled: true,
    },
    {
        id: 'docs',
        name: 'Docs',
        url: 'https://docs.example.com',
        icon: 'BookOpen',
        openMode: 'newTab',
        enabled: true,
    },
    {
        id: 'radarr',
        name: 'Radarr',
        url: 'https://radarr.example.com',
        icon: 'Film',
        logoUrl: 'https://radarr.example.com/favicon.ico',
        showPaletteLabel: false,
        enabled: true,
    },
    {
        id: 'xss',
        name: 'XSS',
        url: 'https://ok.example.com',
        logoUrl: 'javascript:alert(1)',
        enabled: true,
    },
]);

assert.equal(tabs.length, 4);
assert.equal(tabs[0].openMode, 'embed');
assert.equal(tabs[2].logoUrl, 'https://radarr.example.com/favicon.ico');
assert.equal(tabs[2].showPaletteLabel, false);
assert.equal(tabs[3].logoUrl, undefined);
assert.equal(normalizeLogoUrl('javascript:alert(1)'), '');
assert.equal(normalizeLogoUrl('/static/applets/sonarr.png'), '/static/applets/sonarr.png');
assert.equal(normalizeLogoUrl('/static/applets/not-a-real-app.png'), '');
assert.equal(normalizeCustomNavDisplay('applets'), 'applets');
assert.equal(normalizeCustomNavDisplay(''), 'links');
assert.deepEqual(
    buildDesktopNavOrder(['home', 'custom:games', 'about', 'settings', 'logout'], {
        display: 'applets',
        hasVisibleApplets: true,
    }),
    ['home', 'about', APPLETS_NAV_KEY, 'settings', 'logout'],
);
assert.deepEqual(
    buildDesktopNavOrder(['home', 'custom:games', 'about', 'logout'], {
        display: 'applets',
        hasVisibleApplets: true,
    }),
    ['home', 'about', APPLETS_NAV_KEY, 'logout'],
);
assert.deepEqual(
    buildDesktopNavOrder(['home', 'custom:games', 'settings'], {
        display: 'links',
        hasVisibleApplets: true,
    }),
    ['home', 'custom:games', 'settings'],
);
assert.equal(customNavTabKey('games'), 'custom:games');
assert.equal(parseCustomNavTabKey('custom:games'), 'games');
assert.equal(isCustomNavTabKey('custom:games'), true);

const pruned = pruneNavOrderCustomKeys(
    ['home', 'custom:games', 'custom:missing', 'settings'],
    tabs,
);
assert.deepEqual(pruned, ['home', 'custom:games', 'settings']);

console.log('custom nav tabs ok');
