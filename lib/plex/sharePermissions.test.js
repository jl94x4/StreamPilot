import test from 'node:test';
import assert from 'node:assert/strict';
import {
    filterToString,
    normalizeSharePermissions,
    parseFilterString,
    parseXmlAttrs,
    permissionsFromUserAttrs,
    sharingSettingsBody,
    sharingUpdateQuery,
} from './sharePermissions.js';

test('filters use Plex\'s format: %2C between values, | between keys, ! to block', () => {
    assert.equal(filterToString({ ratings: ['G', 'PG'], ratingMode: 'allow', labels: [], labelMode: 'allow' }), 'contentRating=G%2CPG');
    assert.equal(filterToString({ ratings: ['R'], ratingMode: 'block', labels: ['Horror'], labelMode: 'block' }), 'contentRating!=R|label!=Horror');
    assert.equal(filterToString({ ratings: [], labels: [] }), '');
});

test('stored filters read back, encoded or not', () => {
    assert.deepEqual(parseFilterString('contentRating=G%2CPG|label!=Horror'), {
        ratings: ['G', 'PG'], ratingMode: 'allow', labels: ['Horror'], labelMode: 'block',
    });
    assert.deepEqual(parseFilterString('contentRating!=R,NC-17'), {
        ratings: ['R', 'NC-17'], ratingMode: 'block', labels: [], labelMode: 'allow',
    });
    assert.deepEqual(parseFilterString(''), { ratings: [], ratingMode: 'allow', labels: [], labelMode: 'allow' });
    assert.deepEqual(parseFilterString('label=Kids', { ratings: false }), { labels: ['Kids'], labelMode: 'allow' });
});

test('round trip through Plex\'s format keeps every setting', () => {
    const perms = normalizeSharePermissions({
        allowSync: true,
        movies: { ratings: ['U', 'PG', '12'], ratingMode: 'allow' },
        television: { labels: ['Adult'], labelMode: 'block' },
        music: { labels: ['Explicit'], labelMode: 'block' },
    });
    const body = sharingSettingsBody(perms);
    const back = permissionsFromUserAttrs(body);
    assert.deepEqual(back, perms);
});

test('user attributes from plex.tv /api/users', () => {
    const attrs = parseXmlAttrs('<User id="42" title="Alex" allowSync="0" allowChannels="1" filterMovies="contentRating=PG%2C12" filterTelevision="" filterMusic="label!=Explicit">');
    const perms = permissionsFromUserAttrs(attrs);
    assert.equal(perms.allowSync, false);
    assert.equal(perms.allowChannels, true);
    assert.deepEqual(perms.movies.ratings, ['PG', '12']);
    assert.deepEqual(perms.music, { labels: ['Explicit'], labelMode: 'block' });
});

test('update query matches python-plexapi: sorted keys, values URL-encoded once more', () => {
    const query = sharingUpdateQuery({ allowSync: true, movies: { ratings: ['G', 'PG'] } });
    assert.equal(
        query,
        'allowCameraUpload=0&allowChannels=0&allowSync=1&filterMovies=contentRating%3DG%252CPG&filterMusic=&filterTelevision=',
    );
});

test('junk input is cleaned up', () => {
    const perms = normalizeSharePermissions({ allowSync: 'yes', movies: { ratings: 'G, ,PG,G', ratingMode: 'weird' } });
    assert.equal(perms.allowSync, false);
    assert.deepEqual(perms.movies.ratings, ['G', 'PG']);
    assert.equal(perms.movies.ratingMode, 'allow');
});
