import assert from 'node:assert/strict';
import test from 'node:test';
import {
    arrServiceLogoPath,
    arrServiceMark,
    normalizeArrServiceKind,
    resolveArrServiceLogoUrl,
} from './arr-notify-identity.js';

test('normalizeArrServiceKind uses the webhook kind first', () => {
    assert.equal(normalizeArrServiceKind('lidarr', 'Music'), 'lidarr');
    assert.equal(normalizeArrServiceKind('Sonarr', 'TV-4K'), 'sonarr');
    assert.equal(normalizeArrServiceKind('radarr', ''), 'radarr');
});

test('normalizeArrServiceKind falls back to the instance name', () => {
    assert.equal(normalizeArrServiceKind('', 'Lidarr'), 'lidarr');
    assert.equal(normalizeArrServiceKind('', 'Radarr 4K'), 'radarr');
    assert.equal(normalizeArrServiceKind('', 'Movies'), '');
});

test('arrServiceMark is an emoji prefix for lock-screen bodies', () => {
    assert.equal(arrServiceMark('lidarr'), '🎵 ');
    assert.equal(arrServiceMark('sonarr'), '📺 ');
    assert.equal(arrServiceMark('radarr'), '🎬 ');
    assert.equal(arrServiceMark('unknown'), '');
});

test('arrServiceLogoPath and public URL stay on bundled applets', () => {
    assert.equal(arrServiceLogoPath('lidarr'), '/static/applets/lidarr.png');
    assert.equal(arrServiceLogoPath('../evil'), '');
    assert.equal(
        resolveArrServiceLogoUrl({ publicDomain: 'https://portal.example' }, 'lidarr'),
        'https://portal.example/static/applets/lidarr.png',
    );
    assert.equal(resolveArrServiceLogoUrl({}, 'lidarr'), '');
});
