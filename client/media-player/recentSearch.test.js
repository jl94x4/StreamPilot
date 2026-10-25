import assert from 'node:assert/strict';
import test from 'node:test';
import { pushRecentSearch } from './recentSearch.js';

test('pushRecentSearch keeps the newest query first and drops duplicates', () => {
    assert.deepEqual(pushRecentSearch(['The Office', 'Heat'], 'heat'), ['heat', 'The Office']);
    assert.deepEqual(pushRecentSearch(['Heat'], '  '), ['Heat']);
    assert.equal(pushRecentSearch(Array.from({ length: 30 }, (_, i) => `Title ${i}!`), 'New').length, 20);
    assert.equal(pushRecentSearch([], 'New')[0], 'New');
});

test('pushRecentSearch drops the shorter query it was typed from', () => {
    assert.deepEqual(
        pushRecentSearch(['spiderma', 'spiderm', 'spider', 'spide', 'spidef', 'wd'], 'spiderman'),
        ['spiderman', 'spidef', 'wd'],
    );
    assert.deepEqual(
        pushRecentSearch(['spiderman', 'spiderma', 'spidef', 'wd'], ''),
        ['spiderman', 'spidef', 'wd'],
    );
});
