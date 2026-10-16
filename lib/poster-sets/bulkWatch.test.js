import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectBulkWatchUrls,
    isMissingLibraryApplyResult,
    missingLibraryApplyAdvice,
    pickWatchApplyIds,
} from './watcher.js';

test('collectBulkWatchUrls prefers pasted urls and skips comments', () => {
    const urls = collectBulkWatchUrls({
        text: [
            '# ignore',
            '// also ignore',
            'https://mediux.pro/sets/111',
            'https://theposterdb.com/set/222',
            'not-a-url',
            '',
        ].join('\n'),
    });
    assert.deepEqual(urls, [
        'https://mediux.pro/sets/111',
        'https://theposterdb.com/set/222',
    ]);
});

test('collectBulkWatchUrls uses input.urls before CLI outcomes', () => {
    const urls = collectBulkWatchUrls(
        { urls: ['https://mediux.pro/sets/1', 'https://mediux.pro/sets/2'] },
        { outcomes: [{ url: 'https://mediux.pro/sets/9' }] },
    );
    assert.deepEqual(urls, [
        'https://mediux.pro/sets/1',
        'https://mediux.pro/sets/2',
    ]);
});

test('collectBulkWatchUrls falls back to bulk outcomes when the list is empty', () => {
    const urls = collectBulkWatchUrls(
        {},
        {
            outcomes: [
                { url: 'https://theposterdb.com/set/10' },
                { url: 'https://theposterdb.com/set/10' },
                { url: '' },
            ],
        },
    );
    assert.deepEqual(urls, ['https://theposterdb.com/set/10']);
});

test('isMissingLibraryApplyResult treats per-asset and bulk missing-library outcomes as advisory', () => {
    assert.equal(isMissingLibraryApplyResult({
        results: [{ ok: false, message: 'Missing in Action not found in any library.' }],
    }), true);
    assert.equal(isMissingLibraryApplyResult({
        error: 'Bulk apply uploaded 0 posters.',
        outcomes: [{
            results: [{ ok: false, message: 'Braddock: Missing in Action III not found in any library.' }],
        }],
    }), true);
    assert.equal(isMissingLibraryApplyResult({
        error: 'Bulk apply uploaded 0 posters.',
        outcomes: [
            { results: [{ ok: false, message: 'Missing in Action not found in any library.' }] },
            { results: [{ ok: false, message: 'Unable to upload art: timeout' }] },
        ],
    }), false);
    assert.equal(isMissingLibraryApplyResult({ error: 'Apply failed' }), false);
});

test('missingLibraryApplyAdvice mentions Watching when the set was pinned', () => {
    assert.match(
        missingLibraryApplyAdvice('Missing in Action', { pinned: true }),
        /Pinned on Watching/,
    );
    assert.equal(
        missingLibraryApplyAdvice('Missing in Action', { pinned: false }).includes('Pinned'),
        false,
    );
});

test('pickWatchApplyIds queues known assets once they newly match in the library', () => {
    const picked = pickWatchApplyIds([
        { id: 'poster-1', matched: true },
        { id: 'poster-2', matched: false },
    ], {
        knownAssetIds: ['poster-1', 'poster-2'],
        lastMatchedAssetIds: [],
    });
    assert.deepEqual(picked.queueIds, ['poster-1']);
});
