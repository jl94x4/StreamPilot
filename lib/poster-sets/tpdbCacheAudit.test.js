import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTitleIdentity, summarizeTpdbDiskAudit } from './tpdbCacheAudit.js';

test('canonicalTitleIdentity prefers TMDB over TVDB', () => {
    assert.equal(
        canonicalTitleIdentity({ tmdbId: '1396', tvdbId: '78804', mediaType: 'show' }),
        'tmdb:show:1396',
    );
    assert.equal(
        canonicalTitleIdentity({ tvdbId: '78804', mediaType: 'show' }),
        'tvdb:show:78804',
    );
});

test('summarizeTpdbDiskAudit reports aliases and orphans', () => {
    const summary = summarizeTpdbDiskAudit({
        titleEntries: [
            {
                fileName: 'tmdb_show_1396.json',
                tmdbId: '1396',
                tvdbId: '78804',
                mediaType: 'show',
                setIds: ['100', '200'],
                valid: true,
            },
            {
                fileName: 'tvdb_show_78804.json',
                tmdbId: '1396',
                tvdbId: '78804',
                mediaType: 'show',
                setIds: ['100', '200'],
                valid: true,
            },
            { fileName: 'broken.json', valid: false, setIds: [] },
        ],
        setIdsOnDisk: ['100', '200', '999'],
        imageKeysOnDisk: ['aaa', 'bbb', 'ccc'],
        referencedImageKeys: ['aaa', 'bbb'],
    });

    assert.equal(summary.titles.files, 3);
    assert.equal(summary.titles.valid, 2);
    assert.equal(summary.titles.invalid, 1);
    assert.equal(summary.titles.unique, 1);
    assert.equal(summary.titles.aliasExtra, 1);

    assert.equal(summary.sets.files, 3);
    assert.equal(summary.sets.referenced, 2);
    assert.equal(summary.sets.orphan, 1);
    assert.equal(summary.sets.missingFromDisk, 0);

    assert.equal(summary.images.files, 3);
    assert.equal(summary.images.referenced, 2);
    assert.equal(summary.images.orphan, 1);
});
