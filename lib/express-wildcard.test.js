import test from 'node:test';
import assert from 'node:assert/strict';
import {
    EXPRESS_WILDCARD_SEGMENT,
    expressMajor,
    readWildcardPath,
    withWildcard,
} from './express-wildcard.js';

test('expressMajor is a positive integer', () => {
    assert.equal(Number.isInteger(expressMajor), true);
    assert.ok(expressMajor >= 4);
});

test('withWildcard matches Express major', () => {
    const route = withWildcard('/api/discovery/proxy');
    if (expressMajor >= 5) {
        assert.equal(EXPRESS_WILDCARD_SEGMENT, '*path');
        assert.equal(route, '/api/discovery/proxy/*path');
    } else {
        assert.equal(EXPRESS_WILDCARD_SEGMENT, '*');
        assert.equal(route, '/api/discovery/proxy/*');
    }
});

test('readWildcardPath supports Express 4 params[0]', () => {
    assert.equal(readWildcardPath({ params: { 0: 'discover/movies' } }), 'discover/movies');
});

test('readWildcardPath supports Express 5 string and array splat', () => {
    assert.equal(readWildcardPath({ params: { path: 'discover/movies' } }), 'discover/movies');
    assert.equal(
        readWildcardPath({ params: { path: ['discover', 'movies'] } }),
        'discover/movies',
    );
});
