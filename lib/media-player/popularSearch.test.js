import assert from 'node:assert/strict';
import test from 'node:test';
import { bumpPopularQueries, listPopularQueries } from './popularSearch.js';

test('bumpPopularQueries counts a finished query and folds the shorter typing', () => {
    const once = bumpPopularQueries([], 'ted lasso', 10);
    const twice = bumpPopularQueries(once, 'ted lass', 20);
    assert.equal(twice.length, 1);
    assert.equal(twice[0].query, 'ted lasso');
    assert.equal(twice[0].count, 2);
});

test('listPopularQueries hides one-off searches and anything already in Recent', () => {
    const entries = bumpPopularQueries(
        bumpPopularQueries(
            bumpPopularQueries([], 'ted lasso', 1),
            'ted lasso',
            2,
        ),
        'spiderman',
        3,
    );
    assert.deepEqual(listPopularQueries(entries), ['ted lasso']);
    assert.deepEqual(listPopularQueries(entries, { skip: ['ted lasso'] }), []);
});
