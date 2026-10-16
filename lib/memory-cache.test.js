import assert from 'node:assert/strict';
import test from 'node:test';
import { createTtlLruCache } from './memory-cache.js';

test('createTtlLruCache returns value within TTL', () => {
    const cache = createTtlLruCache({ maxEntries: 10, defaultTtlMs: 60_000, name: 't' });
    cache.set('a', { n: 1 });
    assert.deepEqual(cache.get('a'), { n: 1 });
    assert.equal(cache.size, 1);
});

test('createTtlLruCache expires entries', async () => {
    const cache = createTtlLruCache({ maxEntries: 10, defaultTtlMs: 5, name: 'ttl' });
    cache.set('a', 'x');
    assert.equal(cache.get('a'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0);
});

test('createTtlLruCache evicts oldest when over maxEntries', () => {
    const cache = createTtlLruCache({ maxEntries: 2, defaultTtlMs: 60_000, name: 'lru' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.size, 2);
});

test('createTtlLruCache LRU touch keeps recently used', () => {
    const cache = createTtlLruCache({ maxEntries: 2, defaultTtlMs: 60_000, name: 'lru2' });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // touch a → b becomes oldest
    cache.set('c', 3);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c'), 3);
});

test('createTtlLruCache stats expose bounds', () => {
    const cache = createTtlLruCache({ maxEntries: 50, defaultTtlMs: 1000, name: 'stats' });
    cache.set('x', true);
    assert.deepEqual(cache.stats(), {
        name: 'stats',
        size: 1,
        maxEntries: 50,
        defaultTtlMs: 1000,
    });
});

test('createTtlLruCache keys lists live entries', async () => {
    const cache = createTtlLruCache({ maxEntries: 10, defaultTtlMs: 5, name: 'keys' });
    cache.set('a', 1);
    cache.set('b', 2);
    assert.deepEqual(cache.keys().sort(), ['a', 'b']);
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(cache.keys(), []);
});

test('createTtlLruCache supports infinite TTL', () => {
    const cache = createTtlLruCache({
        maxEntries: 8,
        defaultTtlMs: Number.POSITIVE_INFINITY,
        name: 'forever',
    });
    cache.set('k', 'v');
    assert.equal(cache.get('k'), 'v');
});
