import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PROFILE_UNAVAILABLE,
    assembleProfilePayload,
    buildAccountStrip,
    buildTrophyCase,
    collapseProfileRequests,
    decidePeerProfileAccess,
    findPortalUserForAccountId,
    isSameProfileSubject,
    resolveAchievementsAccountId,
    statsToWrapUpAnalytics,
} from './assemble.js';

const portalUser = {
    id: 'plex-share-1',
    plexId: 'plex-share-1',
    plexAccountId: '42',
    username: 'jay',
    email: 'jay@example.com',
    thumb: 'https://plex.tv/users/jay/avatar',
    joiningDate: '2024-01-01T00:00:00.000Z',
    expiryDate: '2027-01-01T00:00:00.000Z',
    lastLogin: '2026-08-01T00:00:00.000Z',
    plexAccessStatus: 'active',
    plexAuthToken: 'secret-token',
    libraryIds: [1, 2],
};

test('findPortalUserForAccountId matches portal, plex, and jellyfin ids', () => {
    const users = [
        portalUser,
        { id: 'jellyfin:abc', jellyfinId: 'abc', username: 'sam' },
    ];
    assert.equal(findPortalUserForAccountId(users, '42')?.username, 'jay');
    assert.equal(findPortalUserForAccountId(users, 'plex-share-1')?.username, 'jay');
    assert.equal(findPortalUserForAccountId(users, 'abc')?.username, 'sam');
    assert.equal(findPortalUserForAccountId(users, 'jellyfin:abc')?.username, 'sam');
    assert.equal(findPortalUserForAccountId(users, 'missing'), null);
});

test('isSameProfileSubject matches viewer to subject across id fields', () => {
    assert.equal(isSameProfileSubject({
        viewer: { id: 'plex-share-1' },
        viewerAccountId: '42',
        subjectAccountId: '42',
        portalUser,
    }), true);
    assert.equal(isSameProfileSubject({
        viewer: { id: 'other' },
        viewerAccountId: '99',
        subjectAccountId: '42',
        portalUser,
    }), false);
});

test('decidePeerProfileAccess: self and admin always get the full account', () => {
    assert.deepEqual(decidePeerProfileAccess({ isSelf: true, hideStreamUsers: 'hidden', leaderboardOptOut: true }), {
        ok: true,
        obfuscate: false,
        includeAccount: true,
        hideAchievements: false,
        locked: false,
        privateToPeers: false,
    });
    assert.equal(decidePeerProfileAccess({ viewerIsAdmin: true, leaderboardOptOut: true }).includeAccount, true);
});

test('decidePeerProfileAccess: hidden 404s peers; achievements opt-out only hides trophies', () => {
    const hidden = decidePeerProfileAccess({ hideStreamUsers: 'hidden' });
    assert.equal(hidden.ok, false);
    assert.equal(hidden.status, 404);
    assert.equal(hidden.error, PROFILE_UNAVAILABLE);

    const opted = decidePeerProfileAccess({
        leaderboardOptOut: true,
        showUsernamesInAnalytics: true,
        privacyShowName: true,
    });
    assert.equal(opted.ok, true);
    assert.equal(opted.hideAchievements, true);
    assert.equal(opted.obfuscate, false);
});

test('decidePeerProfileAccess: member name opt-out obfuscates peers when admin shows names', () => {
    assert.equal(decidePeerProfileAccess({
        hideStreamUsers: 'false',
        showUsernamesInAnalytics: true,
        privacyShowName: false,
    }).obfuscate, true);
});

test('decidePeerProfileAccess: anonymous and analytics-username-off obfuscate peers', () => {
    assert.equal(decidePeerProfileAccess({ hideStreamUsers: 'anonymous', showUsernamesInAnalytics: true }).obfuscate, true);
    assert.equal(decidePeerProfileAccess({ hideStreamUsers: 'false', showUsernamesInAnalytics: false }).obfuscate, true);
    assert.equal(decidePeerProfileAccess({ hideStreamUsers: 'false', showUsernamesInAnalytics: true }).obfuscate, false);
});

test('buildAccountStrip never copies tokens or libraries', () => {
    const strip = buildAccountStrip(portalUser);
    assert.equal(strip.email, 'jay@example.com');
    assert.equal(strip.expiryDate, '2027-01-01T00:00:00.000Z');
    assert.equal(strip.id, 'plex-share-1');
    assert.equal(strip.plexAuthToken, undefined);
    assert.equal(strip.libraryIds, undefined);
});

test('assembleProfilePayload: peer never receives email, expiry, or requests', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        viewerIsAdmin: false,
        obfuscate: false,
        includeAccount: false,
        portalUser,
        subjectAccountId: '42',
        snapshot: {
            accountId: '42',
            username: 'jay',
            xp: 1200,
            level: 8,
            earnedCount: 3,
            stats: { hoursWatched: 40, totalPlays: 90 },
        },
        achievementsEnabled: true,
        showOnProfile: true,
        requests: { total: 4, pending: 1, recent: [{ id: 1, title: 'Dune' }] },
        dossier: {
            accountId: '42',
            username: 'jay',
            rank: 2,
            boardSize: 10,
            xp: 1200,
            level: 8,
            earnedCount: 3,
            trophyCase: [{ id: 'movies_10', name: 'Movie buff', rarity: 'rare', icon: '🎬' }],
            lastBadge: { id: 'movies_10', name: 'Movie buff' },
        },
    });
    assert.equal(payload.account, null);
    assert.equal(payload.requests, null);
    assert.equal(payload.identity.username, 'jay');
    assert.equal(payload.identity.accountId, '42');
    assert.equal(payload.achievements.trophyCase[0].id, 'movies_10');
    assert.ok(!JSON.stringify(payload).includes('jay@example.com'));
    assert.ok(!JSON.stringify(payload).includes('secret-token'));
});

test('assembleProfilePayload: obfuscated peers lose accountId and thumb', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        obfuscate: true,
        includeAccount: false,
        portalUser,
        subjectAccountId: '42',
        dossier: { username: 'jay', rank: 4, thumb: 'https://plex.tv/users/jay/avatar', xp: 10, level: 1 },
        snapshot: { username: 'jay', xp: 10, level: 1, stats: {} },
        achievementsEnabled: true,
        showOnProfile: true,
    });
    assert.equal(payload.identity.username, 'Viewer 4');
    assert.equal(payload.identity.accountId, undefined);
    assert.equal(payload.identity.thumb, null);
});

test('assembleProfilePayload: self includes account strip even when opted out', () => {
    const payload = assembleProfilePayload({
        isSelf: true,
        viewerIsAdmin: false,
        includeAccount: true,
        portalUser,
        subjectAccountId: '42',
        snapshot: {
            accountId: '42',
            username: 'jay',
            xp: 50,
            level: 2,
            leaderboardOptOut: true,
            stats: { hoursWatched: 3, totalPlays: 8 },
        },
        achievementsEnabled: true,
        showOnProfile: true,
        requests: { total: 2, pending: 0, recent: [] },
    });
    assert.equal(payload.account.email, 'jay@example.com');
    assert.equal(payload.achievements.leaderboardOptOut, true);
    assert.equal(payload.requests.total, 2);
    assert.equal(payload.identity.isMe, true);
});

test('assembleProfilePayload: showOnProfile false hides trophies', () => {
    const payload = assembleProfilePayload({
        isSelf: true,
        includeAccount: true,
        portalUser,
        snapshot: { xp: 10, level: 1, badges: { movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' } }, stats: {} },
        achievementsEnabled: true,
        showOnProfile: false,
    });
    assert.equal(payload.achievements.showOnProfile, false);
    assert.equal(payload.achievements.trophyCase, undefined);
    assert.equal(payload.identity.xp, 10);
});

test('statsToWrapUpAnalytics maps snapshot stats for wrap-up cards', () => {
    const wrap = statsToWrapUpAnalytics(
        { totalPlays: 12, hoursWatched: 4.5, moviePlays: 3, episodePlays: 9 },
        { rank: 7, boardSize: 20 },
    );
    assert.equal(wrap.totalPlays, 12);
    assert.equal(wrap.hoursWatched, 4.5);
    assert.equal(wrap.leaderboardRank, 7);
    assert.equal(wrap.leaderboardSource, 'achievements');
});

test('resolveAchievementsAccountId prefers local PMS snapshot over empty plex.tv alias', () => {
    const owner = {
        id: 'cloud-99',
        plexId: 'cloud-99',
        plexAccountId: '999999',
        username: 'ItsThatJA',
    };
    const state = {
        users: {
            999999: { accountId: '999999', username: 'ItsThatJA', xp: 0, level: 1, earnedCount: 0, badges: {} },
            1: {
                accountId: '1',
                username: 'ItsThatJA',
                xp: 8400,
                level: 15,
                earnedCount: 12,
                badges: { movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' } },
            },
        },
    };
    assert.equal(resolveAchievementsAccountId(owner, '999999', state, {
        mergeViewerIds: true,
        viewerAccountId: '999999',
        username: 'ItsThatJA',
        adminPlexId: '999999',
    }), '1');
});

test('resolveAchievementsAccountId does not steal the viewer snapshot for a peer id', () => {
    const peer = {
        id: 'share-12',
        plexId: 'share-12',
        plexAccountId: '12',
        username: 'danprice7',
    };
    const state = {
        users: {
            1: {
                accountId: '1',
                username: 'ItsThatJA',
                xp: 8400,
                level: 15,
                earnedCount: 12,
                badges: { movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' } },
            },
            12: { accountId: '12', username: 'danprice7', xp: 400, level: 4, badges: {} },
        },
    };
    assert.equal(resolveAchievementsAccountId(peer, '12', state, {
        viewerAccountId: '1',
        username: 'ItsThatJA',
        adminPlexId: '999999',
    }), '12');
    assert.equal(resolveAchievementsAccountId(null, '12', state, {
        viewerAccountId: '1',
        username: 'ItsThatJA',
        adminPlexId: '999999',
    }), '12');
});

test('decidePeerProfileAccess: private profiles lock peers and stay open to admins', () => {
    const locked = decidePeerProfileAccess({ privacyShowProfile: false, showUsernamesInAnalytics: true });
    assert.equal(locked.ok, true);
    assert.equal(locked.locked, true);
    assert.equal(locked.includeAccount, false);

    const admin = decidePeerProfileAccess({
        viewerIsAdmin: true,
        privacyShowProfile: false,
        hideStreamUsers: 'hidden',
    });
    assert.equal(admin.includeAccount, true);
    assert.equal(admin.locked, false);
    assert.equal(admin.privateToPeers, true);
});

test('resolveAchievementsAccountId matches snapshot by username when ids do not overlap', () => {
    const user = { id: 'share-5', plexId: 'share-5', plexAccountId: '888', username: 'jay' };
    const state = {
        users: {
            12: { accountId: '12', username: 'jay', xp: 400, level: 4, badges: {} },
        },
    };
    assert.equal(resolveAchievementsAccountId(user, null, state, { username: 'jay' }), '12');
});

test('collapseProfileRequests merges HD and 4K rows for the same title', () => {
    const collapsed = collapseProfileRequests([
        { id: 1, title: 'Neagley', tmdbId: 11, type: 'movie', is4k: false, status: 2, statusLabel: 'Approved', posterUrl: '/a.jpg' },
        { id: 2, title: 'Neagley', tmdbId: 11, type: 'movie', is4k: true, status: 2, statusLabel: 'Approved', posterUrl: '/a.jpg' },
        { id: 3, title: 'Other', tmdbId: 22, type: 'movie', is4k: false, status: 1, statusLabel: 'Pending' },
    ], { limit: 6 });
    assert.equal(collapsed.length, 2);
    assert.equal(collapsed[0].title, 'Neagley');
    assert.equal(collapsed[0].tmdbId, 11);
    assert.deepEqual(collapsed[0].qualities, ['HD', '4K']);
    assert.equal(collapsed[0].status, 'Approved');
    assert.equal(collapsed[1].title, 'Other');
});

test('assembleProfilePayload: snapshot badges fill trophy case even without dossier', () => {
    const payload = assembleProfilePayload({
        isSelf: true,
        includeAccount: true,
        portalUser,
        snapshot: {
            accountId: '1',
            username: 'jay',
            xp: 8400,
            level: 15,
            earnedCount: 1,
            badges: { movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' } },
            stats: { hoursWatched: 40, totalPlays: 90 },
        },
        achievementsEnabled: true,
        showOnProfile: true,
    });
    assert.equal(payload.identity.xp, 8400);
    assert.ok(payload.identity.level > 1);
    assert.equal(payload.achievements.earned[0].id, 'movies_10');
    assert.equal(payload.achievements.trophyCase[0].id, 'movies_10');
});

test('buildTrophyCase leads with pinned badges then rarity fills', () => {
    const earned = [
        { id: 'movies_10', rarity: 'rare', earnedAt: '2025-06-01T00:00:00.000Z' },
        { id: 'movies_100', rarity: 'legendary', earnedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'movies_1', rarity: 'common', earnedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const cased = buildTrophyCase(earned, ['movies_10']);
    assert.equal(cased[0].id, 'movies_10');
    assert.equal(cased[0].pinned, true);
    assert.equal(cased[1].id, 'movies_100');
    assert.equal(cased[1].pinned, false);
});

test('assembleProfilePayload: pinned badges lead the trophy case', () => {
    const payload = assembleProfilePayload({
        isSelf: true,
        includeAccount: true,
        portalUser,
        snapshot: {
            accountId: '1',
            username: 'jay',
            xp: 8400,
            level: 15,
            earnedCount: 2,
            pinnedBadgeIds: ['movies_10'],
            badges: {
                movies_10: { earnedAt: '2025-06-01T00:00:00.000Z' },
                movies_100: { earnedAt: '2024-01-01T00:00:00.000Z' },
            },
            stats: { hoursWatched: 40, totalPlays: 90 },
        },
        achievementsEnabled: true,
        showOnProfile: true,
    });
    assert.equal(payload.achievements.trophyCase[0].id, 'movies_10');
    assert.equal(payload.achievements.trophyCase[0].pinned, true);
    assert.equal(payload.achievements.pinnedBadgeIds[0], 'movies_10');
});

test('assembleProfilePayload: admin viewing a member receives their requests', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        viewerIsAdmin: true,
        includeAccount: true,
        portalUser,
        subjectAccountId: '42',
        snapshot: { accountId: '42', username: 'jay', xp: 10, level: 1, stats: {} },
        achievementsEnabled: true,
        showOnProfile: true,
        requests: { total: 3, pending: 1, recent: [{ id: 9, title: 'Dune', tmdbId: 438631 }] },
    });
    assert.equal(payload.requests.total, 3);
    assert.equal(payload.features.requests, true);
    assert.equal(payload.identity.isMe, false);
});

test('findPortalUserForAccountId matches username', () => {
    assert.equal(findPortalUserForAccountId([portalUser], 'Jay')?.username, 'jay');
    assert.equal(findPortalUserForAccountId([portalUser], 'Viewer 4'), null);
});

test('assembleProfilePayload: locked peers only get a name', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        viewerIsAdmin: false,
        locked: true,
        privateToPeers: true,
        includeAccount: false,
        portalUser,
        subjectAccountId: '42',
        snapshot: { accountId: '42', username: 'jay', xp: 1200, stats: { hoursWatched: 40 } },
        achievementsEnabled: true,
        showOnProfile: true,
        dossier: { username: 'jay', rank: 2, trophyCase: [{ id: 'movies_10' }] },
    });
    assert.equal(payload.privacy.locked, true);
    assert.equal(payload.identity.username, 'jay');
    assert.equal(payload.identity.accountId, undefined);
    assert.equal(payload.identity.xp, 0);
    assert.equal(payload.achievements, null);
    assert.equal(payload.watch, null);
    assert.equal(payload.compare, null);
    assert.equal(payload.account, null);
});

test('assembleProfilePayload: taste and compare come from snapshots', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        includeAccount: false,
        portalUser,
        subjectAccountId: '42',
        snapshot: {
            accountId: '42',
            username: 'jay',
            xp: 400,
            badges: {
                movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' },
                movies_1: { earnedAt: '2024-02-01T00:00:00.000Z' },
            },
            stats: {
                hoursWatched: 12,
                uniqueMovies: 4,
                uniqueShows: 2,
                genreMovies_Action: 8,
                genreMovies_Documentary: 5,
                genreShows_Drama: 3,
                genreShows_Documentary: 2,
            },
        },
        viewerSnapshot: {
            accountId: '1',
            username: 'me',
            xp: 100,
            badges: { movies_10: { earnedAt: '2023-01-01T00:00:00.000Z' } },
        },
        achievementsEnabled: true,
        showOnProfile: true,
    });
    assert.equal(payload.watch.taste.hoursWatched, 12);
    assert.equal(payload.watch.taste.genres[0].kind, 'movie');
    assert.equal(payload.watch.taste.movieGenres[0].label, 'Action');
    assert.equal(payload.watch.taste.movieGenres[1].label, 'Documentary');
    assert.equal(payload.watch.taste.showGenres[0].label, 'Drama');
    assert.equal(payload.watch.taste.showGenres[1].label, 'Documentary');
    assert.equal(payload.compare.xpGap, 300);
    assert.equal(payload.compare.sharedCount, 1);
    assert.equal(payload.compare.shared[0].id, 'movies_10');
    assert.deepEqual(payload.compare.sharedWatched, []);
});

test('assembleProfilePayload merges subject wrap-up titles onto snapshot counts', () => {
    const payload = assembleProfilePayload({
        isSelf: false,
        includeAccount: false,
        portalUser,
        subjectAccountId: '42',
        snapshot: { accountId: '42', username: 'jay', xp: 400, stats: { hoursWatched: 12, totalPlays: 4 } },
        wrapUp: { totalPlays: 40, topMovie: { title: 'Heat' }, topBinge: { title: 'The Bear' }, timeOfDay: 'Night Owl' },
        wrapUpPending: false,
        achievementsEnabled: true,
        showOnProfile: true,
    });
    assert.equal(payload.watch.wrapUp.topMovie.title, 'Heat');
    assert.equal(payload.watch.wrapUp.topBinge.title, 'The Bear');
    assert.equal(payload.watch.wrapUp.hoursWatched, 12);
    assert.equal(payload.watch.wrapUp.totalPlays, 40);
    assert.equal(payload.watch.wrapUpPending, false);
    assert.equal(payload.watch.period, 'last365');
});
