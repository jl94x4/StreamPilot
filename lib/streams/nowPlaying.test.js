import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isDiscoverNowPlayingEnabled,
    userAllowsDiscoverNowPlaying,
    mapPlexSessionToNowPlaying,
    mapJellyfinSessionToNowPlaying,
    sessionBelongsToPlexUser,
    sessionBelongsToJellyfinUser,
    collectOthersWatchingSamePlexTitle,
    collectOthersWatchingSameJellyfinTitle,
} from './nowPlaying.js';

test('isDiscoverNowPlayingEnabled defaults true', () => {
    assert.equal(isDiscoverNowPlayingEnabled({}), true);
    assert.equal(isDiscoverNowPlayingEnabled({ discoverNowPlayingEnabled: false }), false);
    assert.equal(isDiscoverNowPlayingEnabled({ discoverNowPlayingEnabled: true }), true);
});

test('userAllowsDiscoverNowPlaying defaults true', () => {
    assert.equal(userAllowsDiscoverNowPlaying({}), true);
    assert.equal(userAllowsDiscoverNowPlaying({ showDiscoverNowPlaying: false }), false);
    assert.equal(userAllowsDiscoverNowPlaying({ showDiscoverNowPlaying: true }), true);
});

test('mapPlexSessionToNowPlaying prefers show backdrop art for episodes', () => {
    const mapped = mapPlexSessionToNowPlaying({
        type: 'episode',
        title: 'Made in America',
        grandparentTitle: 'The Sopranos',
        parentIndex: 1,
        index: 10,
        duration: 1000,
        viewOffset: 100,
        art: '/library/metadata/ep/art',
        parentArt: '/library/metadata/season/art',
        grandparentArt: '/library/metadata/show/art',
        grandparentThumb: '/library/metadata/show/thumb',
        Player: { state: 'playing' },
    });
    assert.ok(mapped);
    assert.equal(mapped.artPath, '/library/metadata/show/art');
    assert.equal(mapped.thumbPath, '/library/metadata/show/thumb');
});

test('mapPlexSessionToNowPlaying maps movie art from metadata art', () => {
    const mapped = mapPlexSessionToNowPlaying({
        type: 'movie',
        title: 'Inception',
        art: '/library/metadata/movie/art',
        thumb: '/library/metadata/movie/thumb',
        duration: 2000,
        viewOffset: 100,
        Player: { state: 'playing' },
    });
    assert.ok(mapped);
    assert.equal(mapped.artPath, '/library/metadata/movie/art');
});

test('mapPlexSessionToNowPlaying maps episode with TMDB guid', () => {
    const mapped = mapPlexSessionToNowPlaying({
        type: 'episode',
        title: 'The One',
        grandparentTitle: 'Friends',
        parentIndex: 1,
        index: 2,
        duration: 1000,
        viewOffset: 250,
        Guid: [{ id: 'tmdb://1668' }],
        Player: { state: 'playing' },
        Session: { id: 'sess-1' },
    });
    assert.ok(mapped);
    assert.equal(mapped.mediaType, 'tv');
    assert.equal(mapped.title, 'Friends');
    assert.equal(mapped.episodeTitle, 'The One');
    assert.equal(mapped.season, 1);
    assert.equal(mapped.episode, 2);
    assert.equal(mapped.tmdbId, 1668);
    assert.equal(mapped.progress, 25);
});

test('mapPlexSessionToNowPlaying prefers series TMDB id over episode guid', () => {
    const mapped = mapPlexSessionToNowPlaying({
        type: 'episode',
        title: 'Pilot',
        grandparentTitle: 'Breaking Bad',
        parentIndex: 1,
        index: 1,
        duration: 1000,
        viewOffset: 100,
        guid: 'tmdb://62085',
        grandparentGuid: 'tmdb://1396',
        Guid: [{ id: 'tmdb://62085' }],
        Player: { state: 'playing' },
    });
    assert.ok(mapped);
    assert.equal(mapped.tmdbId, 1396);
});

test('mapPlexSessionToNowPlaying maps movie', () => {
    const mapped = mapPlexSessionToNowPlaying({
        type: 'movie',
        title: 'Inception',
        Guid: [{ id: 'tmdb://27205' }],
        duration: 2000,
        viewOffset: 1000,
        Player: { state: 'paused' },
    });
    assert.ok(mapped);
    assert.equal(mapped.mediaType, 'movie');
    assert.equal(mapped.tmdbId, 27205);
    assert.equal(mapped.state, 'paused');
    assert.equal(mapped.season, null);
});

test('mapJellyfinSessionToNowPlaying maps episode', () => {
    const mapped = mapJellyfinSessionToNowPlaying({
        Id: 'session',
        UserId: 'u1',
        UserName: 'jason',
        NowPlayingItem: {
            Type: 'Episode',
            Name: 'Pilot',
            SeriesName: 'Lost',
            ParentIndexNumber: 1,
            IndexNumber: 1,
            SeriesId: 'series-1',
            RunTimeTicks: 100000000,
            ProviderIds: { Tmdb: '123' },
        },
        PlayState: { PositionTicks: 25000000, IsPaused: false },
    });
    assert.ok(mapped);
    assert.equal(mapped.mediaType, 'tv');
    assert.equal(mapped.title, 'Lost');
    assert.equal(mapped.season, 1);
    assert.equal(mapped.episode, 1);
    assert.equal(mapped.progress, 25);
});

test('sessionBelongsToPlexUser admin matches PMS owner accountID 1 without cloud id overlap', () => {
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'episode',
            title: 'Episode 1',
            grandparentTitle: 'Body Cam',
            accountID: '1',
            User: { id: 'unrelated-cloud-profile', title: 'Home Profile' },
        },
        {
            isAdmin: true,
            accountId: '998877',
            accountIds: ['998877'],
            plexId: '998877',
            username: 'ItsThatJA',
        },
    ), true);
});

test('sessionBelongsToPlexUser admin matches owner via User.id 1 when accountID missing', () => {
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'movie',
            title: 'Owner Movie',
            User: { id: '1', title: 'Home Profile' },
            Player: { state: 'playing' },
        },
        {
            isAdmin: true,
            accountId: '998877',
            plexId: '998877',
            username: 'owner',
        },
    ), true);
});

test('sessionBelongsToPlexUser matches account id or username', () => {
    assert.equal(sessionBelongsToPlexUser({ User: { id: 42, title: 'Other' } }, { accountId: 42 }), true);
    assert.equal(sessionBelongsToPlexUser({ User: { id: 1, title: 'Jason' } }, { username: 'jason' }), true);
    assert.equal(sessionBelongsToPlexUser({ User: { id: 1, title: 'Someone' } }, { accountId: 9, username: 'jason' }), false);
});

test('sessionBelongsToPlexUser matches plex cloud id and aliases', () => {
    assert.equal(sessionBelongsToPlexUser(
        { User: { id: '998877', title: 'Web Profile' } },
        { accountId: '1', plexId: '998877' },
    ), true);
    assert.equal(sessionBelongsToPlexUser(
        { User: { id: '9', title: 'ItsThatJA' } },
        { accountId: '1', username: 'admin', aliases: ['ItsThatJA'] },
    ), true);
    assert.equal(sessionBelongsToPlexUser(
        { type: 'episode', accountID: 1, User: { title: 'Someone' } },
        { accountId: '1' },
    ), true);
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'episode',
            User: {
                title: 'Web User',
                thumb: 'https://plex.tv/users/abc123xyz/avatar?c=1',
            },
        },
        { plexId: 'abc123xyz' },
    ), true);
    assert.equal(sessionBelongsToPlexUser(
        { User: [{ id: '55', title: 'Android Profile' }] },
        { accountId: '55' },
    ), true);
});

test('sessionBelongsToPlexUser matches owner cloud plexId with local accountID 1', () => {
    // Owner JWT often has plex.tv cloud plexId while PMS sessions report accountID "1".
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'movie',
            accountID: '1',
            User: { id: '1', title: 'Server Owner' },
        },
        {
            accountId: '1',
            accountIds: ['1', '9988776655'],
            plexId: '9988776655',
            username: 'owner',
        },
    ), true);
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'episode',
            User: {
                title: 'Web Profile',
                thumb: 'https://plex.tv/users/9988776655/avatar?c=1',
            },
        },
        {
            accountId: '1',
            accountIds: ['1', '9988776655'],
            plexId: '9988776655',
        },
    ), true);
});

test('sessionBelongsToPlexUser matches dashed uuid against undashed thumb/Account', async () => {
    const { expandPlexIdVariants } = await import('./nowPlaying.js');
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const nodash = 'a1b2c3d4e5f67890abcdef1234567890';
    assert.ok(expandPlexIdVariants(uuid).includes(nodash));
    assert.equal(sessionBelongsToPlexUser(
        {
            type: 'movie',
            Account: { id: nodash },
            User: { title: 'Web', thumb: `https://plex.tv/users/${nodash}/avatar` },
        },
        { accountIds: [uuid], plexId: '999' },
    ), true);
});

test('pickOwnPlexNowPlayingSession admin does not steal sole playable session', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'movie',
            title: 'Someone Else Movie',
            viewOffset: 50,
            User: { id: '999', title: 'Someone Else Entirely' },
            accountID: '999',
            Player: { state: 'playing' },
        },
    ], {
        isAdmin: true,
        accountId: '1',
        accountIds: ['1', '998877'],
        plexId: '998877',
        username: 'owner',
    });
    assert.equal(picked, null);
});

test('pickOwnPlexNowPlayingSession admin does not steal others when multiple play', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'movie',
            title: 'Guest Movie',
            viewOffset: 50,
            User: { id: '55', title: 'Guest' },
            accountID: '55',
            Player: { state: 'playing' },
        },
        {
            type: 'episode',
            title: 'Ep',
            grandparentTitle: 'Show',
            viewOffset: 10,
            User: { id: '66', title: 'Other' },
            accountID: '66',
            Player: { state: 'playing' },
        },
    ], {
        isAdmin: true,
        accountId: '1',
        accountIds: ['1'],
        username: 'owner',
    });
    assert.equal(picked, null);
});

test('pickOwnPlexNowPlayingSession admin does not steal single active foreign session', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'movie',
            title: 'Paused Guest Movie',
            viewOffset: 350,
            User: { id: '55', title: 'Guest' },
            accountID: '55',
            Player: { state: 'paused' },
        },
        {
            type: 'episode',
            title: 'Active Guest Episode',
            grandparentTitle: 'Guest Show',
            viewOffset: 120,
            User: { id: '66', title: 'Some Other Label' },
            accountID: '66',
            Player: { state: 'playing' },
        },
    ], {
        isAdmin: true,
        accountId: '1',
        accountIds: ['1'],
        username: 'owner',
    });
    assert.equal(picked, null);
});

test('pickOwnPlexNowPlayingSession admin does not fall back to paused-only session', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'movie',
            title: 'Paused Session',
            viewOffset: 220,
            User: { id: '55', title: 'Guest' },
            accountID: '55',
            Player: { state: 'paused' },
        },
    ], {
        isAdmin: true,
        accountId: '1',
        accountIds: ['1'],
        username: 'owner',
    });
    assert.equal(picked, null);
});

test('pickOwnPlexNowPlayingSession admin matches owner accountID 1 for home profile', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'episode',
            title: 'Episode 1',
            grandparentTitle: 'Body Cam',
            parentIndex: 11,
            index: 1,
            accountID: '1',
            User: { id: 'home-profile-id', title: 'Home User' },
            Player: { state: 'playing' },
        },
    ], {
        isAdmin: true,
        accountId: '998877',
        accountIds: ['998877'],
        plexId: '998877',
        username: 'ItsThatJA',
    });
    assert.equal(picked?.grandparentTitle || picked?.title, 'Body Cam');
});

test('pickOwnPlexNowPlayingSession admin still matches local owner account 1', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'movie',
            title: 'Owner Movie',
            viewOffset: 80,
            User: { id: '1', title: 'Owner' },
            accountID: '1',
            Player: { state: 'playing' },
        },
    ], {
        isAdmin: true,
        accountId: '998877',
        accountIds: ['998877'],
        plexId: '998877',
        username: 'owner',
    });
    assert.equal(picked?.title, 'Owner Movie');
});

test('asArray wraps single Plex Metadata objects', async () => {
    const { asArray } = await import('./nowPlaying.js');
    assert.deepEqual(asArray(undefined), []);
    assert.deepEqual(asArray([{ id: 1 }]), [{ id: 1 }]);
    assert.deepEqual(asArray({ id: 1 }), [{ id: 1 }]);
});

test('pickOwnPlexNowPlayingSession prefers playing movie/episode', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession([
        {
            type: 'track',
            viewOffset: 999,
            User: { id: '1', title: 'Jason' },
            Player: { state: 'playing' },
        },
        {
            type: 'episode',
            viewOffset: 100,
            title: 'Ep',
            grandparentTitle: 'Show',
            User: { id: '1', title: 'Jason' },
            Player: { state: 'paused' },
        },
        {
            type: 'episode',
            viewOffset: 400,
            title: 'Ep2',
            grandparentTitle: 'Show',
            User: { id: '1', title: 'Jason' },
            Player: { state: 'playing' },
        },
    ], { accountId: '1', username: 'jason' });
    assert.equal(picked?.title, 'Ep2');
    assert.equal(picked?.viewOffset, 400);
});

test('pickOwnPlexNowPlayingSession accepts single Metadata object', async () => {
    const { pickOwnPlexNowPlayingSession } = await import('./nowPlaying.js');
    const picked = pickOwnPlexNowPlayingSession({
        type: 'movie',
        title: 'Inception',
        User: { id: '1', title: 'Jason' },
        Player: { state: 'playing' },
    }, { username: 'jason' });
    assert.equal(picked?.title, 'Inception');
});

test('sessionBelongsToJellyfinUser matches id or username', () => {
    assert.equal(sessionBelongsToJellyfinUser({ UserId: 'abc', UserName: 'x' }, { jellyfinId: 'abc' }), true);
    assert.equal(sessionBelongsToJellyfinUser({ UserId: 'z', UserName: 'Jason' }, { username: 'jason' }), true);
    assert.equal(sessionBelongsToJellyfinUser({ UserId: 'z', UserName: 'x' }, { jellyfinId: 'nope', username: 'jason' }), false);
});

test('collectOthersWatchingSamePlexTitle never includes the viewer', () => {
    const mine = {
        type: 'movie',
        title: 'Dune',
        ratingKey: '99',
        User: { id: '1', title: 'Jason' },
    };
    const others = collectOthersWatchingSamePlexTitle([
        mine,
        { type: 'movie', title: 'Dune', ratingKey: '99', User: { id: '42', title: 'Sam' } },
        { type: 'movie', title: 'Other', ratingKey: '12', User: { id: '7', title: 'Lee' } },
    ], mine, { accountId: '1', username: 'Jason' });
    assert.equal(others.length, 1);
    assert.equal(others[0].username, 'Sam');
    assert.equal(others[0].accountId, '42');
});

test('collectOthersWatchingSameJellyfinTitle matches series id', () => {
    const mine = {
        UserId: 'me',
        UserName: 'Jason',
        NowPlayingItem: { Type: 'Episode', SeriesId: 'lost', SeriesName: 'Lost', Name: 'Pilot' },
    };
    const others = collectOthersWatchingSameJellyfinTitle([
        mine,
        {
            UserId: 'sam',
            UserName: 'Sam',
            NowPlayingItem: { Type: 'Episode', SeriesId: 'lost', SeriesName: 'Lost', Name: 'Walkabout' },
        },
    ], mine, { jellyfinId: 'me', username: 'Jason' });
    assert.equal(others.length, 1);
    assert.equal(others[0].accountId, 'sam');
});
