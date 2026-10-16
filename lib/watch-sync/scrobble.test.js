import assert from 'node:assert/strict';
import test from 'node:test';
import { planScrobbles, traktScrobbleBody } from './scrobble.js';

const movie = (progress, player = 'playing') => ({
    sessionKey: '1',
    type: 'movie',
    title: 'Heat',
    progress,
    player,
    ids: { imdb: 'tt0113277' },
});

test('live watch starts once, updates every 10 percent, and stops at 80', () => {
    const first = planScrobbles({}, [movie(5)]);
    assert.deepEqual(first.actions.map((step) => step.action), ['start']);

    const held = planScrobbles(first.next, [movie(8)]);
    assert.equal(held.actions.length, 0);

    const moved = planScrobbles(held.next, [movie(16)]);
    assert.deepEqual(moved.actions.map((step) => step.action), ['start']);

    const done = planScrobbles(moved.next, [movie(82)]);
    assert.deepEqual(done.actions.map((step) => step.action), ['stop']);

    const again = planScrobbles(done.next, [movie(90)]);
    assert.equal(again.actions.length, 0);
});

test('leaving a session paused below 80 percent does not mark it watched', () => {
    const started = planScrobbles({}, [movie(20)]);
    const left = planScrobbles(started.next, []);
    assert.deepEqual(left.actions.map((step) => step.action), ['pause']);
    assert.equal(traktScrobbleBody(left.actions[0].session).movie.ids.imdb, 'tt0113277');
});

test('a session already past 80 percent is marked watched once', () => {
    const first = planScrobbles({}, [movie(91)]);
    assert.deepEqual(first.actions.map((step) => step.action), ['stop']);
    const again = planScrobbles(first.next, [movie(95)]);
    assert.equal(again.actions.length, 0);
});

test('movie scrobbles drop tvdb ids and clamp a zero progress', () => {
    const body = traktScrobbleBody({
        type: 'movie',
        progress: 0,
        title: 'Heat',
        year: 1995,
        ids: { imdb: 'TT0113277', tmdb: 949, tvdb: 123 },
    });
    assert.equal(body.progress, 1);
    assert.equal(body.movie.title, 'Heat');
    assert.equal(body.movie.year, 1995);
    assert.deepEqual(body.movie.ids, { imdb: 'tt0113277', tmdb: 949 });
    assert.equal(traktScrobbleBody({ type: 'movie', progress: 10, ids: { tvdb: 1 } }), null);
});

test('episode scrobbles send one show id', () => {
    const body = traktScrobbleBody({
        type: 'episode',
        progress: 12,
        season: 2,
        episode: 4,
        showTitle: 'Breaking Bad',
        showIds: { tvdb: 81189, tmdb: 1396, imdb: 'tt0903747' },
    });
    assert.deepEqual(body.show.ids, { tvdb: 81189 });
    assert.equal(body.show.title, 'Breaking Bad');
});

test('a rejected scrobble is not sent again while that session is playing', () => {
    const first = planScrobbles({}, [movie(5)]);
    first.next['1'].rejected = true;
    const again = planScrobbles(first.next, [movie(40)]);
    assert.equal(again.actions.length, 0);
    assert.equal(again.next['1'].rejected, true);
});

test('episode scrobbles use the show id plus season and episode', () => {
    const body = traktScrobbleBody({
        type: 'episode',
        progress: 12,
        season: 2,
        episode: 4,
        showIds: { tvdb: 81189 },
    });
    assert.equal(body.episode.season, 2);
    assert.equal(body.episode.number, 4);
    assert.equal(body.show.ids.tvdb, 81189);
});
