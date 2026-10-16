import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createRewriter,
    invertPathRewrites,
    expandPathRewriteCandidates,
    pathMatchesLibraryRoot,
    remapPathOntoLibraryRoot,
} from './rewrite.js';

test('invertPathRewrites maps container paths back to host form when needed', () => {
    const rules = [{ from: '/mnt/user/', to: '/media/' }];
    assert.equal(
        invertPathRewrites('/media/TV SHOWS/Show/Season 3', rules),
        '/mnt/user/TV SHOWS/Show/Season 3',
    );
    assert.equal(
        invertPathRewrites('/mnt/user/TV SHOWS/Show/Season 3', rules),
        '/mnt/user/TV SHOWS/Show/Season 3',
    );
});

test('expandPathRewriteCandidates covers host and container for Unraid-style maps', () => {
    const rules = [{ from: '/mnt/user/', to: '/media/' }];
    const fromContainer = expandPathRewriteCandidates('/media/TV SHOWS/Show/Season 3', rules);
    assert.ok(fromContainer.includes('/media/TV SHOWS/Show/Season 3'));
    assert.ok(fromContainer.includes('/mnt/user/TV SHOWS/Show/Season 3'));

    const fromHost = expandPathRewriteCandidates('/mnt/user/TV SHOWS/Show/Season 3', rules);
    assert.ok(fromHost.includes('/mnt/user/TV SHOWS/Show/Season 3'));
    assert.ok(fromHost.includes('/media/TV SHOWS/Show/Season 3'));
});

test('expandPathRewriteCandidates is a no-op without rules', () => {
    assert.deepEqual(
        expandPathRewriteCandidates('/data/TV/Show', []),
        ['/data/TV/Show'],
    );
});

test('path matching prefers a candidate under the Plex library root', () => {
    const rules = [{ from: '/mnt/user/', to: '/media/' }];
    const candidates = expandPathRewriteCandidates('/media/TV SHOWS/Show/Season 3', rules);
    const libPath = '/mnt/user/TV SHOWS/';
    const hit = candidates.find((candidate) => pathMatchesLibraryRoot(candidate, libPath));
    assert.equal(hit, '/mnt/user/TV SHOWS/Show/Season 3');

    const sameMountLib = '/media/TV SHOWS/';
    const sameHit = candidates.find((candidate) => pathMatchesLibraryRoot(candidate, sameMountLib));
    assert.equal(sameHit, '/media/TV SHOWS/Show/Season 3');
});

test('remapPathOntoLibraryRoot aligns shared TV SHOWS folder without rewrite rules', () => {
    const remapped = remapPathOntoLibraryRoot(
        '/media/TV SHOWS/Love Island All Stars (2024)/Season 2',
        '/mnt/user/TV SHOWS/',
    );
    assert.equal(remapped, '/mnt/user/TV SHOWS/Love Island All Stars (2024)/Season 2');
    assert.equal(
        remapPathOntoLibraryRoot('/mnt/user/TV SHOWS/Show/Season 1', '/mnt/user/TV SHOWS/'),
        '/mnt/user/TV SHOWS/Show/Season 1',
    );
});

test('invert then forward rewrite round-trips Unraid-style mounts', () => {
    const rules = [{ from: '/mnt/user/', to: '/media/' }];
    const forward = createRewriter(rules);
    const host = '/mnt/user/TV SHOWS/Love Island/Season 3';
    const container = forward(host);
    assert.equal(container, '/media/TV SHOWS/Love Island/Season 3');
    assert.equal(invertPathRewrites(container, rules), host);
});
