import assert from 'node:assert/strict';
import test from 'node:test';
import {
    lookupJobNotificationPoster,
    pickTmdbPosterResult,
    resetJobPosterCacheForTests,
} from './jobPoster.js';

test('pickTmdbPosterResult prefers matching type, exact title, then year', () => {
    const results = [
        { mediaType: 'movie', title: 'The Office', posterPath: '/m.jpg', releaseDate: '2003-01-01' },
        { mediaType: 'tv', name: 'The Office', posterPath: '/uk.jpg', firstAirDate: '2001-07-09' },
        { mediaType: 'tv', name: 'The Office', posterPath: '/us.jpg', firstAirDate: '2005-03-24' },
        { mediaType: 'person', name: 'Steve Carell', profilePath: '/p.jpg' },
    ];
    const picked = pickTmdbPosterResult(results, { mediaType: 'tv', year: '2005', title: 'The Office' });
    assert.equal(picked.posterPath, '/us.jpg');
});

test('lookupJobNotificationPoster returns TMDB poster meta from a mocked search', async () => {
    resetJobPosterCacheForTests();
    const meta = await lookupJobNotificationPoster({
        sourcePath: '/tv/The Office/The.Office.S03E01.mkv',
        search: async () => ({
            results: [
                { mediaType: 'tv', id: 2316, name: 'The Office', posterPath: '/office.jpg', firstAirDate: '2005-03-24' },
            ],
        }),
    });
    assert.equal(meta.mediaType, 'tv');
    assert.equal(meta.tmdbId, 2316);
    assert.equal(meta.posterPath, '/office.jpg');
    assert.equal(meta.posterUrl, 'https://image.tmdb.org/t/p/w185/office.jpg');
});

test('lookupJobNotificationPoster caches results and skips TMDB when the key is missing', async () => {
    resetJobPosterCacheForTests();
    let calls = 0;
    const search = async () => {
        calls += 1;
        return { results: [{ mediaType: 'movie', id: 1, title: 'Dune', posterPath: '/dune.jpg', releaseDate: '2021-10-22' }] };
    };
    const first = await lookupJobNotificationPoster({
        sourcePath: '/movies/Dune.2021.mkv',
        search,
    });
    const second = await lookupJobNotificationPoster({
        sourcePath: '/movies/Dune.2021.1080p.mkv',
        search,
    });
    assert.equal(first.posterPath, '/dune.jpg');
    assert.equal(second.posterPath, '/dune.jpg');
    assert.equal(calls, 1);

    resetJobPosterCacheForTests();
    const missing = await lookupJobNotificationPoster({
        sourcePath: '/tv/Show.S01E01.mkv',
        config: {},
    });
    assert.equal(missing, null);
});

test('lookupJobNotificationPoster returns null when search throws', async () => {
    resetJobPosterCacheForTests();
    const meta = await lookupJobNotificationPoster({
        sourcePath: '/tv/Show.S01E01.mkv',
        search: async () => {
            throw new Error('timeout');
        },
    });
    assert.equal(meta, null);
});
