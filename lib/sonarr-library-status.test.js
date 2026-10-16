import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSonarrSeasonAvailability } from './sonarr-library-status.js';

test('buildSonarrSeasonAvailability does not mark un-aired seasons complete', () => {
    const futureAir = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const seasons = buildSonarrSeasonAvailability([
        {
            seasonNumber: 1,
            episodeNumber: 1,
            monitored: true,
            hasFile: false,
            airDate: futureAir,
        },
    ]);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0].airedTotal, 0);
    assert.equal(seasons[0].complete, false);
});

test('buildSonarrSeasonAvailability marks aired seasons complete when files match', () => {
    const pastAir = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const seasons = buildSonarrSeasonAvailability([
        {
            seasonNumber: 1,
            episodeNumber: 1,
            monitored: true,
            hasFile: true,
            airDate: pastAir,
        },
    ]);
    assert.equal(seasons[0].airedTotal, 1);
    assert.equal(seasons[0].complete, true);
});

test('buildSonarrSeasonAvailability marks unmonitored aired seasons complete when files match', () => {
    const pastAir = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const seasons = buildSonarrSeasonAvailability([
        {
            seasonNumber: 1,
            episodeNumber: 1,
            monitored: false,
            hasFile: true,
            airDate: pastAir,
        },
    ], { monitoredOnly: false });
    assert.equal(seasons[0].airedTotal, 1);
    assert.equal(seasons[0].complete, true);
});
