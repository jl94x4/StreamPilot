import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWatchInsights, watchedFor } from './watchInsights.ts';

const min = (m) => m * 60_000;
// Local-time dates so weekday / hour checks do not depend on the machine's time zone.
const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h, 0, 0).getTime();

const items = [
    { ratingKey: '1', type: 'movie', title: 'Heat', year: 1995, durationMs: min(170), viewCount: 3, lastViewedAt: at(2026, 10, 4), genres: ['Crime', 'Drama'], studio: 'Warner', userRating: 10 },
    { ratingKey: '2', type: 'movie', title: 'Up', year: 2009, durationMs: min(96), viewCount: 1, lastViewedAt: at(2026, 10, 11), genres: ['Animation'], studio: 'Pixar', userRating: 8 },
    { ratingKey: '3', type: 'show', title: 'Severance', year: 2022, durationMs: min(50), viewedLeafCount: 18, leafCount: 19, lastViewedAt: at(2026, 10, 18, 22), genres: ['Drama', 'Sci-Fi'], studio: 'Apple TV+' },
    { ratingKey: '4', type: 'show', title: 'Chernobyl', year: 2019, durationMs: min(60), viewedLeafCount: 5, leafCount: 5, lastViewedAt: at(2026, 9, 20, 9), genres: ['Drama'], studio: 'HBO' },
    { ratingKey: '5', type: 'movie', title: 'Never watched', year: 2020, durationMs: min(100), viewCount: 0, lastViewedAt: 0, genres: ['Drama'] },
    { ratingKey: '3', type: 'show', title: 'Severance (duplicate row)', viewedLeafCount: 18, lastViewedAt: at(2026, 10, 18) },
];

test('time is plays times run time for a movie, and episodes times run time for a show', () => {
    assert.deepEqual(watchedFor(items[0]), { episodes: 0, plays: 3, ms: min(170) * 3 });
    assert.deepEqual(watchedFor(items[2]), { episodes: 18, plays: 18, ms: min(50) * 18 });
    // A show with no known episode length falls back to 45 minutes.
    assert.equal(watchedFor({ type: 'show', viewedLeafCount: 2 }).ms, min(45) * 2);
});

test('totals only count what was watched, once per title', () => {
    const r = buildWatchInsights(items, { now: at(2026, 10, 30) });
    assert.equal(r.titles, 4);
    assert.equal(r.movies, 2);
    assert.equal(r.shows, 2);
    assert.equal(r.episodes, 23);
    assert.equal(r.rewatches, 1);
    assert.equal(r.showsFinished, 1);
    assert.equal(r.showsInProgress, 1);
    // 3 x 170m + 96m + 18 x 50m + 5 x 60m = 510 + 96 + 900 + 300 = 1806 minutes
    assert.equal(r.hours, 30.1);
});

test('genres rank by time watched, decades and studios by titles', () => {
    const r = buildWatchInsights(items, { now: at(2026, 10, 30) });
    assert.equal(r.genres[0].name, 'Drama');
    assert.deepEqual(r.decades.map((d) => d.label), ['1990s', '2000s', '2010s', '2020s']);
    assert.ok(r.studios.some((s) => s.name === 'HBO'));
});

test('favourites: most-watched show, most-rewatched movie, top rated', () => {
    const r = buildWatchInsights(items, { now: at(2026, 10, 30) });
    assert.equal(r.topShows[0].item.title, 'Severance');
    assert.equal(r.topRewatched[0].item.title, 'Heat');
    assert.equal(r.topRated[0].item.title, 'Heat');
});

test('when you watch describes each title\'s last watch: weekday, part of day and the last twelve months', () => {
    const r = buildWatchInsights(items, { now: at(2026, 10, 30) });
    assert.equal(r.months.length, 12);
    assert.equal(r.months[r.months.length - 1].titles, 3);
    assert.equal(r.months[r.months.length - 2].titles, 1);
    assert.equal(r.weekdays.reduce((a, b) => a + b, 0), 4);
    assert.equal(r.peakPart, 2);
});

test('facts are only given when the data backs them', () => {
    const none = buildWatchInsights([], { now: at(2026, 10, 30) });
    assert.equal(none.titles, 0);
    assert.deepEqual(none.facts, []);
    const r = buildWatchInsights(items, { now: at(2026, 10, 30) });
    assert.equal(r.facts.find((f) => f.id === 'oldest').value, '1995');
    assert.equal(r.facts.find((f) => f.id === 'binge').value, 'Severance');
    assert.equal(r.facts.find((f) => f.id === 'binge').detail, '18');
    assert.ok(r.facts.find((f) => f.id === 'days'));
});
