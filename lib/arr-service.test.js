import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createArrInstance,
    maskArrInstancesForApi,
    resolveArrInstanceDefaultProfileId,
    resolveArrInstanceDefaultRootFolder,
    sanitizeArrInstances,
} from './arr-service.js';

const profiles = [
    { id: 1, name: 'HD' },
    { id: 8, name: 'Ultra-HD' },
];
const folders = [
    { id: 1, path: '/data/tv' },
    { id: 2, path: '/data/tv-4k' },
];

test('createArrInstance stores default profile and root folder', () => {
    const instance = createArrInstance({
        type: 'sonarr',
        defaultQualityProfileId: '8',
        defaultRootFolder: ' /data/tv-4k ',
    });
    assert.equal(instance.defaultQualityProfileId, 8);
    assert.equal(instance.defaultRootFolder, '/data/tv-4k');
});

test('sanitizeArrInstances persists routing defaults and mask keeps them', () => {
    const sanitized = sanitizeArrInstances([{
        id: 'sonarr-1',
        type: 'sonarr',
        name: 'Sonarr',
        url: 'http://sonarr',
        apiKey: 'secret',
        defaultQualityProfileId: 8,
        defaultRootFolder: '/data/tv-4k',
    }]);
    assert.equal(sanitized[0].defaultQualityProfileId, 8);
    assert.equal(sanitized[0].defaultRootFolder, '/data/tv-4k');

    const masked = maskArrInstancesForApi(sanitized, '••••••••');
    assert.equal(masked[0].apiKey, '••••••••');
    assert.equal(masked[0].defaultQualityProfileId, 8);
    assert.equal(masked[0].defaultRootFolder, '/data/tv-4k');
});

test('resolveArrInstanceDefaultProfileId prefers a configured profile that still exists', () => {
    assert.equal(resolveArrInstanceDefaultProfileId({ defaultQualityProfileId: 8 }, profiles), 8);
    assert.equal(resolveArrInstanceDefaultProfileId({ defaultQualityProfileId: 99 }, profiles), 1);
    assert.equal(resolveArrInstanceDefaultProfileId({}, profiles), 1);
    assert.equal(resolveArrInstanceDefaultProfileId({ defaultQualityProfileId: 8 }, []), null);
});

test('resolveArrInstanceDefaultRootFolder prefers a configured folder that still exists', () => {
    assert.equal(resolveArrInstanceDefaultRootFolder({ defaultRootFolder: '/data/tv-4k' }, folders), '/data/tv-4k');
    assert.equal(resolveArrInstanceDefaultRootFolder({ defaultRootFolder: '/missing' }, folders), '/data/tv');
    assert.equal(resolveArrInstanceDefaultRootFolder({}, folders), '/data/tv');
    assert.equal(resolveArrInstanceDefaultRootFolder({ defaultRootFolder: '/data/tv' }, []), null);
});
