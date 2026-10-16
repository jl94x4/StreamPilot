import test from 'node:test';
import assert from 'node:assert/strict';
import { createTvmazeClient } from './tvmazeClient.js';

test('getEpisode looks up by TVDB then fetches episodebynumber', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(String(url));
        if (String(url).includes('/lookup/shows?thetvdb=78804')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 169, name: 'Breaking Bad' }),
                text: async () => '',
            };
        }
        if (String(url).includes('/shows/169/episodebynumber')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    id: 1,
                    name: 'Pilot',
                    season: 1,
                    number: 1,
                    airdate: '2008-01-20',
                    summary: '<p>A high school chemistry teacher&nbsp;turns to crime.</p>',
                }),
                text: async () => '',
            };
        }
        return { ok: false, status: 404, json: async () => null, text: async () => '' };
    };

    const client = createTvmazeClient({ fetchImpl });
    const ep = await client.getEpisode({ tvdbId: 78804, seasonNumber: 1, episodeNumber: 1 });
    assert.equal(ep?.title, 'Pilot');
    assert.equal(ep?.originallyAvailableAt, '2008-01-20');
    assert.match(ep?.summary || '', /chemistry teacher/);
    assert.ok(!ep?.summary?.includes('<p>'));
    assert.equal(ep?.source, 'tvmaze');
    assert.equal(calls.length, 2);
});

test('lookup falls back to IMDb when TVDB miss', async () => {
    const fetchImpl = async (url) => {
        if (String(url).includes('thetvdb=')) {
            return { ok: false, status: 404, json: async () => null, text: async () => '' };
        }
        if (String(url).includes('imdb=tt0903747')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ id: 169 }),
                text: async () => '',
            };
        }
        if (String(url).includes('/episodebynumber')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ name: 'Pilot', airdate: '2008-01-20', summary: null }),
                text: async () => '',
            };
        }
        return { ok: false, status: 404, json: async () => null, text: async () => '' };
    };

    const client = createTvmazeClient({ fetchImpl });
    const ep = await client.getEpisode({
        tvdbId: 999999999,
        imdbId: 'tt0903747',
        seasonNumber: 1,
        episodeNumber: 1,
    });
    assert.equal(ep?.title, 'Pilot');
});
