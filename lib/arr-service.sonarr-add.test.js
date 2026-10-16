import assert from 'node:assert/strict';
import test from 'node:test';
import { lookupSonarrSeriesForAdd } from './arr-service.js';

test('lookupSonarrSeriesForAdd skips redundant TMDB→TVDB bridge after a TVDB miss', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        return {
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => [],
        };
    };
    const instance = {
        id: 'sonarr-1',
        type: 'sonarr',
        name: 'Sonarr',
        url: 'http://sonarr.local',
        apiKey: 'test-key',
        enabled: true,
    };

    const hit = await lookupSonarrSeriesForAdd(instance, {
        tmdbId: 12345,
        tvdbId: 999,
        config: { tmdbApiKey: 'tmdb-key' },
        fetchImpl,
        timeoutMs: 1000,
    });

    assert.equal(hit, null);
    assert.equal(calls.filter((url) => url.includes('/series/lookup?term=tvdb:999')).length, 1);
    assert.equal(calls.filter((url) => url.includes('/series/lookup?term=tmdb:12345')).length, 1);
    // Already tried tvdb:999 — do not call TMDB external_ids just to look up the same id again.
    assert.equal(calls.filter((url) => url.includes('api.themoviedb.org')).length, 0);
});
