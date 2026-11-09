import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWatchInsights } from './watchInsights.ts';
import { buildInsightDetail } from './insightDetails.ts';

const min = (m) => m * 60_000;
const at = (y, m, d, h = 20) => new Date(y, m - 1, d, h, 0, 0).getTime();
// A stand-in translator: the key, then the values it was given.
const t = (key, vars) => `${key.replace('mediaPlayerPage.', '')}${vars ? ` ${JSON.stringify(vars)}` : ''}`;

const items = [
    { ratingKey: '1', type: 'movie', title: 'Heat', year: 1995, durationMs: min(170), viewCount: 3, lastViewedAt: at(2026, 10, 4), genres: ['Crime', 'Drama'], studio: 'Warner' },
    { ratingKey: '2', type: 'movie', title: 'Up', year: 2009, durationMs: min(96), viewCount: 1, lastViewedAt: at(2026, 10, 11), genres: ['Animation'], studio: 'Pixar' },
    { ratingKey: '3', type: 'show', title: 'Severance', year: 2022, durationMs: min(50), viewedLeafCount: 18, leafCount: 19, lastViewedAt: at(2026, 10, 18, 22), genres: ['Drama'], studio: 'Apple TV+' },
    { ratingKey: '4', type: 'show', title: 'Chernobyl', year: 2019, durationMs: min(60), viewedLeafCount: 5, leafCount: 5, lastViewedAt: at(2026, 9, 20, 9), genres: ['Drama'], studio: 'HBO' },
];
const ins = buildWatchInsights(items, { now: at(2026, 10, 30) });
const labels = (section) => section.rows.map((r) => r.label);

test('hours: films and series are split, and the biggest time sinks are listed', () => {
    const d = buildInsightDetail('hours', ins, t);
    assert.deepEqual(labels(d.sections[0]).slice(0, 2), ['Severance', 'Heat']);
    assert.equal(d.stats.length, 3);
});

test('shows finished: finished and still-going are told apart, with progress', () => {
    const d = buildInsightDetail('showsFinished', ins, t);
    assert.deepEqual(labels(d.sections[0]), ['Chernobyl']);
    const going = d.sections[1].rows[0];
    assert.equal(going.label, 'Severance');
    assert.equal(going.value, '18/19');
    assert.equal(going.sub, '95%');
});

test('every row that is a title carries the item so selecting it can open it', () => {
    const d = buildInsightDetail('rewatches', ins, t);
    assert.equal(d.sections[0].rows[0].item.title, 'Heat');
    assert.equal(d.stats[1].value, '2');
});

test('genres: all genres ranked, then the top titles of the top three', () => {
    const d = buildInsightDetail('genres', ins, t);
    assert.equal(d.sections[0].rows[0].label, 'Drama');
    assert.ok(d.sections.length >= 2);
    assert.ok(labels(d.sections[1]).includes('Severance'));
});

test('decades and studios list the titles behind each bar', () => {
    const decades = buildInsightDetail('decades', ins, t);
    assert.ok(decades.sections.some((s) => labels(s).includes('Heat')));
    const studios = buildInsightDetail('studios', ins, t);
    assert.ok(studios.sections.some((s) => labels(s).includes('Up')));
});

test('when you watch: hourly columns, day and month lists', () => {
    const d = buildInsightDetail('when', ins, t);
    assert.equal(d.sections[0].columns.length, 24);
    assert.equal(d.sections[1].rows.length, 7);
    assert.ok(d.sections[2].rows.length >= 1);
});

test('fun facts open to their own list; an unknown one is empty, not a crash', () => {
    assert.equal(buildInsightDetail('fact:oldest', ins, t).sections[0].rows[0].label, 'Heat');
    assert.equal(buildInsightDetail('fact:binge', ins, t).sections[0].rows[0].label, 'Severance');
    assert.equal(buildInsightDetail('fact:busiestMonth', ins, t).sections[0].rows.length, 3);
    assert.deepEqual(buildInsightDetail('fact:nope', ins, t).sections, []);
});
