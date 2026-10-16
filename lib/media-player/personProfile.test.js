import assert from 'node:assert/strict';
import test from 'node:test';
import {
    pickTmdbPersonMatch,
    resolvePlayerPersonProfile,
    toPlayerPersonProfile,
} from './personProfile.js';

test('pickTmdbPersonMatch prefers exact names and overlapping on-server titles', () => {
    const picked = pickTmdbPersonMatch([
        { id: 1, mediaType: 'movie', title: 'Avatar' },
        { id: 9, mediaType: 'person', name: 'James Jordan', popularity: 80, knownFor: [{ title: 'Unrelated' }] },
        { id: 11, mediaType: 'person', name: 'James Jordan', popularity: 12, knownFor: [{ title: 'Lioness' }] },
        { id: 22, mediaType: 'person', name: 'Zoe Saldana', popularity: 90, knownFor: [{ title: 'Avatar' }] },
    ], { name: 'James Jordan', knownTitles: ['Lioness'] });
    assert.equal(picked.id, 11);
});

test('toPlayerPersonProfile keeps birth, death, place, and biography', () => {
    const profile = toPlayerPersonProfile({
        name: 'Damian Lewis',
        biography: 'English actor.',
        birthday: '1971-02-11',
        deathday: null,
        knownForDepartment: 'Acting',
        placeOfBirth: "St. John's, London, England",
        profilePath: '/abc.jpg',
    });
    assert.equal(profile.name, 'Damian Lewis');
    assert.equal(profile.birthday, '1971-02-11');
    assert.equal(profile.deathday, null);
    assert.equal(profile.placeOfBirth, "St. John's, London, England");
    assert.equal(profile.biography, 'English actor.');
    assert.equal(toPlayerPersonProfile({ biography: 'Nope' }), null);
});

test('resolvePlayerPersonProfile searches TMDB and returns mapped details', async () => {
    const calls = [];
    const profile = await resolvePlayerPersonProfile({
        name: 'Damian Lewis',
        knownTitles: ['Band of Brothers'],
        tmdbApiKey: 'test-key',
        fetchImpl: async (url) => {
            const href = String(url);
            calls.push(href);
            if (href.includes('/search/person')) {
                return {
                    ok: true,
                    json: async () => ({
                        results: [{
                            id: 11962,
                            name: 'Damian Lewis',
                            popularity: 12,
                            profile_path: '/p.jpg',
                            known_for: [{ title: 'Band of Brothers', media_type: 'tv' }],
                        }],
                    }),
                };
            }
            if (href.includes('/person/11962')) {
                return {
                    ok: true,
                    json: async () => ({
                        id: 11962,
                        name: 'Damian Lewis',
                        biography: 'English actor and producer.',
                        birthday: '1971-02-11',
                        deathday: null,
                        known_for_department: 'Acting',
                        place_of_birth: "St. John's, London, England",
                        profile_path: '/p.jpg',
                    }),
                };
            }
            throw new Error(`unexpected ${href}`);
        },
    });
    assert.equal(profile.name, 'Damian Lewis');
    assert.equal(profile.birthday, '1971-02-11');
    assert.equal(profile.placeOfBirth, "St. John's, London, England");
    assert.match(profile.biography, /English actor/);
    assert.equal(calls.some((url) => url.includes('/search/person')), true);
    assert.equal(await resolvePlayerPersonProfile({ name: 'X', tmdbApiKey: '' }), null);
});
