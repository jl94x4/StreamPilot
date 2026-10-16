import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRootFolderLabel, rootFolderDisplayName } from './rootFolderLabel.js';

test('root folder labels use the last path segment', () => {
    assert.equal(rootFolderDisplayName('/media/films'), 'films');
    assert.equal(rootFolderDisplayName('/media/films/'), 'films');
    assert.equal(rootFolderDisplayName('D:\\Media\\TV'), 'TV');
    assert.equal(rootFolderDisplayName('films'), 'films');
});

test('root folder labels keep the full path when names collide', () => {
    const folders = [
        { path: '/mnt/disk1/films' },
        { path: '/mnt/disk2/films' },
    ];
    assert.equal(formatRootFolderLabel(folders[0], { folders }), '/mnt/disk1/films');
    assert.equal(
        formatRootFolderLabel(folders[0], { folders: [{ path: '/media/films' }], freeText: '30.2 TB free' }),
        'films (30.2 TB free)',
    );
});
