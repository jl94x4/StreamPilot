import assert from 'node:assert/strict';
import test from 'node:test';
import { sharedWatchedFromAnalytics } from './sharedWatched.js';

const cache = {
    all: {
        topMovies: [
            {
                title: 'Dune',
                thumbUrl: '/dune.jpg',
                viewers: {
                    1: { plays: 4 },
                    42: { plays: 2 },
                },
            },
            {
                title: 'Solo movie',
                viewers: { 42: { plays: 9 } },
            },
        ],
        topShows: [
            {
                title: 'Friends',
                viewers: {
                    1: { plays: 20 },
                    42: { plays: 11 },
                },
            },
        ],
    },
};

test('sharedWatchedFromAnalytics intersects viewer maps', () => {
    const rows = sharedWatchedFromAnalytics({
        cache,
        viewerIds: ['1'],
        subjectIds: ['42', 'plex-share-1'],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'Friends');
    assert.equal(rows[0].kind, 'tv');
    assert.equal(rows[0].subjectPlays, 11);
    assert.equal(rows[1].title, 'Dune');
    assert.equal(rows[1].kind, 'movie');
});

test('sharedWatchedFromAnalytics skips self-compare and missing ids', () => {
    assert.deepEqual(sharedWatchedFromAnalytics({ cache, viewerIds: ['42'], subjectIds: ['42'] }), []);
    assert.deepEqual(sharedWatchedFromAnalytics({ cache, viewerIds: [], subjectIds: ['42'] }), []);
});
