import assert from 'node:assert/strict';
import {
    isNativeNavIconKey,
    navItemIconLogoId,
    navItemIconLogoPublicPath,
    sanitizeNavItemIcons,
} from './nav-item-icons.js';

assert.equal(isNativeNavIconKey('home'), true);
assert.equal(isNativeNavIconKey('media-automation'), true);
assert.equal(isNativeNavIconKey('custom:games'), false);
assert.equal(navItemIconLogoId('home'), 'nav-home');
assert.equal(navItemIconLogoId('../evil'), '');
assert.equal(navItemIconLogoPublicPath('home'), '/api/branding/custom-tab/nav-home');

const sanitized = sanitizeNavItemIcons({
    home: { icon: 'Sparkles', logoUrl: 'https://example.com/home.png' },
    request: { logoUrl: '/static/applets/overseerr.png' },
    'custom:nope': { icon: 'Film' },
    bogus: { icon: 'NotARealIcon' },
    xss: { logoUrl: 'javascript:alert(1)' },
    empty: {},
});

assert.equal(sanitized.home.icon, 'Sparkles');
assert.equal(sanitized.home.logoUrl, 'https://example.com/home.png');
assert.equal(sanitized.request.logoUrl, '/static/applets/overseerr.png');
assert.equal(sanitized['custom:nope'], undefined);
assert.equal(sanitized.bogus, undefined);
assert.equal(sanitized.xss, undefined);
assert.equal(sanitized.empty, undefined);

console.log('nav item icons ok');
