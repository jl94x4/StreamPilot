import assert from 'node:assert/strict';
import test from 'node:test';
import { createTraktClient } from './trakt.js';

test('retries an empty Trakt 420 instead of failing the sync', async () => {
    const statuses = [420, 201];
    const fetchImpl = async () => {
        const status = statuses.shift();
        return new Response(status === 201 ? '{"added":{"movies":1}}' : '', {
            status,
            statusText: status === 420 ? '<none>' : 'Created',
        });
    };
    const notes = [];
    const trakt = createTraktClient({
        fetchImpl,
        minWriteGapMs: 0,
        retryDelay: () => 0,
        log: (message) => notes.push(message),
    });
    const result = await trakt.addHistory({ clientId: 'abc', accessToken: 'token' }, { movies: [{ ids: { imdb: 'tt1' } }] });
    assert.equal(result.status, 201);
    assert.equal(statuses.length, 0);
    assert.match(notes[0], /420/);
});

test('includes the Trakt validation message on a 422', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
        message: 'Validation Failed',
        errors: [{ field: 'movie.ids', message: 'could not find a match' }],
    }), { status: 422, statusText: 'Unprocessable Entity' });
    const trakt = createTraktClient({ fetchImpl, minWriteGapMs: 0 });
    await assert.rejects(
        () => trakt.scrobble({ clientId: 'abc', accessToken: 'token' }, 'start', { progress: 1, movie: { ids: { imdb: 'tt1' } } }),
        /Validation Failed.*movie\.ids could not find a match/,
    );
});

test('keeps a still-valid Trakt token when refresh is rejected', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ message: 'invalid' }), {
        status: 422,
        statusText: 'Unprocessable Entity',
    });
    const trakt = createTraktClient({ fetchImpl, minWriteGapMs: 0, log: () => {} });
    const config = {
        clientId: 'abc',
        clientSecret: 'sec',
        accessToken: 'still-good',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };
    const next = await trakt.refreshIfNeeded(config, () => { throw new Error('should not save'); });
    assert.equal(next.accessToken, 'still-good');
});

test('asks for a new Trakt login when the token is expired and refresh fails', async () => {
    const fetchImpl = async () => new Response('', { status: 422, statusText: 'Unprocessable Entity' });
    const trakt = createTraktClient({ fetchImpl, minWriteGapMs: 0 });
    const config = {
        clientId: 'abc',
        clientSecret: 'sec',
        accessToken: 'expired',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    await assert.rejects(() => trakt.refreshIfNeeded(config), /Disconnect and connect Trakt again/);
});
