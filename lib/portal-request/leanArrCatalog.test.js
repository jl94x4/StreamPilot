import assert from 'node:assert/strict';
import test from 'node:test';
import {
    leanRadarrMovie,
    leanSonarrSeries,
    leanLidarrArtist,
    leanRadarrMovieList,
} from './leanArrCatalog.js';
import { buildSonarrSeriesIndexes } from './sonarrSeriesMatch.js';

test('leanRadarrMovie strips fat graph and keeps badge fields', () => {
    const lean = leanRadarrMovie({
        id: 9,
        tmdbId: 27205,
        imdbId: 'tt1375666',
        title: 'Inception',
        originalTitle: 'Inception',
        year: 2010,
        releaseDate: '2010-07-16',
        hasFile: true,
        movieFileId: 3,
        movieFile: { id: 3, relativePath: 'Inception.mkv', size: 9e9 },
        images: [{ coverType: 'poster', url: '/huge' }],
        ratings: { imdb: { value: 8.8 } },
        overview: 'A long synopsis…',
    });
    assert.equal(lean.id, 9);
    assert.equal(lean.tmdbId, 27205);
    assert.equal(lean.hasFile, true);
    assert.equal(lean.imdbId, 'tt1375666');
    assert.equal(lean.movieFile, undefined);
    assert.equal(lean.images, undefined);
    assert.equal(lean.overview, undefined);
});

test('leanRadarrMovie infers hasFile from movieFile', () => {
    const lean = leanRadarrMovie({
        id: 1,
        tmdbId: 1,
        hasFile: false,
        movieFile: { id: 2, relativePath: 'x.mkv' },
    });
    assert.equal(lean.hasFile, true);
});

test('leanSonarrSeries keeps season stats for status matching', () => {
    const lean = leanSonarrSeries({
        id: 4,
        tmdbId: 1396,
        tvdbId: 81189,
        title: 'Breaking Bad',
        status: 'ended',
        statistics: {
            episodeFileCount: 62,
            episodeCount: 62,
            totalEpisodeCount: 62,
            percentOfEpisodes: 100,
        },
        seasons: [
            {
                seasonNumber: 1,
                monitored: true,
                statistics: {
                    episodeFileCount: 7,
                    episodeCount: 7,
                    totalEpisodeCount: 7,
                    percentOfEpisodes: 100,
                },
            },
        ],
        images: [{ url: '/big' }],
        alternateTitles: [{ title: 'Breaking Bad', sceneName: 'Breaking.Bad' }],
    });
    assert.equal(lean.images, undefined);
    assert.equal(lean.statistics.episodeFileCount, 62);
    assert.equal(lean.seasons.length, 1);
    assert.equal(lean.seasons[0].seasonNumber, 1);
    assert.ok(lean.alternateTitles.length >= 1);

    const indexes = buildSonarrSeriesIndexes([lean], { id: 'sonarr-1' });
    assert.ok(indexes.byTmdb.get(1396)?.series);
    assert.ok(indexes.byTvdb.get(81189)?.series);
});

test('leanLidarrArtist keeps music badge stats', () => {
    const lean = leanLidarrArtist({
        id: 2,
        foreignArtistId: 'mbid-abc',
        artistName: 'Radiohead',
        images: [{ url: '/x' }],
        statistics: { trackFileCount: 40, albumCount: 9, totalAlbumCount: 9 },
    });
    assert.equal(lean.foreignArtistId, 'mbid-abc');
    assert.equal(lean.statistics.trackFileCount, 40);
    assert.equal(lean.artistName, undefined);
    assert.equal(lean.images, undefined);
});

test('leanRadarrMovieList filters nulls', () => {
    assert.equal(leanRadarrMovieList([null, { id: 1, tmdbId: 2, hasFile: false }]).length, 1);
});
