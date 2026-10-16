import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileSeasonOptionsWithSonarr } from './seerr-season-status.js';
import { buildMemberSeasonOptions } from './request-app-service.js';

const availableRow = (seasonNumber) => ({
    seasonNumber,
    name: `Season ${seasonNumber}`,
    episodeCount: 10,
    posterPath: null,
    libraryStatus: 5,
    requestStatus: null,
    statusLabel: 'Available',
    requestable: false,
});

test('reconcileSeasonOptionsWithSonarr keeps Seerr stamps when Sonarr was not probed', () => {
    const rows = [availableRow(1)];
    const out = reconcileSeasonOptionsWithSonarr({}, rows);
    assert.equal(out[0].requestable, false);
    assert.equal(out[0].statusLabel, 'Available');
});

test('reconcileSeasonOptionsWithSonarr keeps Available when Sonarr matched this show', () => {
    const rows = [availableRow(1), availableRow(2)];
    const out = reconcileSeasonOptionsWithSonarr(
        { sonarrLibraryStatus: { matched: true, source: 'catalog' } },
        rows,
    );
    assert.equal(out.every((row) => row.statusLabel === 'Available' && row.requestable === false), true);
});

test('reconcileSeasonOptionsWithSonarr reopens seasons when Sonarr confirmed a miss', () => {
    const rows = [availableRow(1), availableRow(2)];
    const out = reconcileSeasonOptionsWithSonarr(
        { sonarrLibraryStatus: { matched: false, source: 'catalog' } },
        rows,
    );
    assert.equal(out.every((row) => row.requestable && row.statusLabel === 'Not requested'), true);
});

test('reconcileSeasonOptionsWithSonarr keeps pending request rows on a Sonarr miss', () => {
    const rows = [{
        ...availableRow(1),
        requestStatus: 1,
        statusLabel: 'Pending',
        requestable: false,
        libraryStatus: null,
    }];
    const out = reconcileSeasonOptionsWithSonarr(
        { sonarrLibraryStatus: { matched: false } },
        rows,
    );
    assert.equal(out[0].statusLabel, 'Pending');
    assert.equal(out[0].requestable, false);
});

test('buildMemberSeasonOptions ignores Seerr Available when Sonarr does not have this TMDB id', () => {
    const seasons = buildMemberSeasonOptions(
        {
            name: 'The Librarians: The Next Chapter',
            firstAirDate: '2025-05-24',
            sonarrLibraryStatus: { matched: false, source: 'catalog' },
            seasons: [
                { seasonNumber: 1, name: 'Season 1', episodeCount: 10 },
                { seasonNumber: 2, name: 'Season 2', episodeCount: 10 },
            ],
        },
        {
            status: 5,
            seasons: [
                { seasonNumber: 1, status: 5 },
                { seasonNumber: 2, status: 5 },
            ],
        },
    );
    assert.equal(seasons.length, 2);
    assert.equal(seasons.every((row) => row.requestable), true);
    assert.equal(seasons.every((row) => row.statusLabel === 'Not requested'), true);
});

test('buildMemberSeasonOptions keeps Available when Sonarr matched the show', () => {
    const seasons = buildMemberSeasonOptions(
        {
            name: 'The Librarians',
            firstAirDate: '2014-12-07',
            sonarrLibraryStatus: { matched: true, source: 'catalog' },
            seasons: [
                { seasonNumber: 1, name: 'Season 1', episodeCount: 10 },
            ],
        },
        {
            status: 5,
            seasons: [{ seasonNumber: 1, status: 5 }],
        },
    );
    assert.equal(seasons[0].requestable, false);
    assert.equal(seasons[0].statusLabel, 'Available');
});
