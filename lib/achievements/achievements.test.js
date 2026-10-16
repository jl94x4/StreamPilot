import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countBadgeDefinitions,
    evaluateAchievements,
    buildStatsFromHistoryItems,
    levelFromXp,
    isSeasonActive,
    isBadgeSeasonActive,
    listActiveSpotlightSeasons,
    estimateUnlockTimestamps,
    enrichHistoryGenres,
    extractCanonicalGenreIds,
    snapshotNeedsGenreRescore,
    GENRE_ENRICHMENT_VERSION,
} from './index.js';
import { mapTautulliHistoryRowToPlexItem } from './tautulliHistory.js';
import { buildPlexLibraryGenreMap } from './plexGenreIndex.js';

test('achievements catalog has hundreds of badges', () => {
    const count = countBadgeDefinitions();
    assert.ok(count >= 200, `expected >= 200 badges, got ${count}`);
});

test('evaluateAchievements awards movie and episode milestones', () => {
    const history = [];
    for (let i = 0; i < 12; i += 1) {
        history.push({
            type: 'movie',
            ratingKey: `m${i}`,
            viewedAt: 1700000000 + i * 86400,
            librarySectionID: 1,
        });
    }
    for (let i = 0; i < 30; i += 1) {
        history.push({
            type: 'episode',
            grandparentKey: 'show-a',
            viewedAt: 1700000000 + i * 3600,
            librarySectionID: 2,
        });
    }
    const stats = buildStatsFromHistoryItems(history);
    const result = evaluateAchievements({ stats, previousBadges: {} });
    assert.ok(result.xp > 0);
    assert.ok(result.level >= 1);
    assert.ok(result.earned.some((b) => b.id === 'movies_10'));
    assert.ok(result.earned.some((b) => b.id.startsWith('episodes_')));
    assert.equal(levelFromXp(result.xp), result.level);
});

test('genre badges count unique comedy movies', () => {
    const history = [];
    for (let i = 0; i < 12; i += 1) {
        history.push({
            type: 'movie',
            ratingKey: `comedy-${i}`,
            viewedAt: 1700000000 + i * 86400,
            Genre: [{ tag: 'Comedy' }],
        });
    }
    history.push({
        type: 'movie',
        ratingKey: 'horror-1',
        viewedAt: 1700000000,
        Genre: [{ tag: 'Horror' }],
    });
    const stats = buildStatsFromHistoryItems(history);
    assert.equal(stats.genreMovies_comedy, 12);
    assert.equal(stats.genreMovies_horror, 1);
    assert.ok(stats.genreTagsSeen >= 2);
    const result = evaluateAchievements({ stats, previousBadges: {} });
    assert.ok(result.earned.some((b) => b.id === 'genre_movies_comedy_10'));
});

test('Tautulli-like history without genre tags does not count documentary badges', () => {
    const history = [];
    for (let i = 0; i < 10; i += 1) {
        history.push(mapTautulliHistoryRowToPlexItem({
            media_type: 'episode',
            rating_key: 80000 + i,
            grandparent_rating_key: 70001,
            grandparent_title: 'Planet Earth',
            started: 1700000000 + i * 3600,
            percent_complete: 100,
            watched_status: 1,
        }));
    }
    const stats = buildStatsFromHistoryItems(history);
    assert.equal(stats.genreShows_documentary || 0, 0);
    assert.equal(stats.episodePlays, 10);
});

test('enrichHistoryGenres fills missing Tautulli episode genres from grandparentRatingKey', async () => {
    const history = [];
    for (let i = 0; i < 10; i += 1) {
        history.push(mapTautulliHistoryRowToPlexItem({
            media_type: 'episode',
            rating_key: 81000 + i,
            grandparent_rating_key: 881001,
            grandparent_title: 'Planet Earth',
            started: 1700000000 + i * 3600,
            percent_complete: 100,
            watched_status: 1,
        }));
    }
    const lookedUp = [];
    const enriched = await enrichHistoryGenres(history, async (ratingKey) => {
        lookedUp.push(String(ratingKey));
        if (String(ratingKey) === '881001') return ['Documentary'];
        return [];
    }, { skipCache: true });
    assert.deepEqual(lookedUp, ['881001']);
    const stats = buildStatsFromHistoryItems(enriched);
    assert.equal(stats.genreShows_documentary, 1);
    assert.equal(stats.episodePlays, 10);
});

test('genre show badges count unique shows, not episodes', () => {
    const history = [];
    for (let show = 0; show < 10; show += 1) {
        for (let ep = 0; ep < 3; ep += 1) {
            history.push({
                type: 'episode',
                ratingKey: `s${show}-e${ep}`,
                grandparentRatingKey: `show-${show}`,
                viewedAt: 1700000000 + show * 86400 + ep,
                Genre: [{ tag: 'Comedy' }, { tag: 'Crime' }],
            });
        }
    }
    const stats = buildStatsFromHistoryItems(history);
    assert.equal(stats.genreShows_comedy, 10);
    assert.equal(stats.genreShows_crime, 10);
    assert.equal(stats.episodePlays, 30);
    const result = evaluateAchievements({ stats, previousBadges: {} });
    assert.ok(result.earned.some((b) => b.id === 'genre_shows_comedy_10' || b.id.startsWith('genre_shows_comedy_')));
});

test('enrichHistoryGenres attaches Plex movie genres onto Tautulli rows', async () => {
    const history = [mapTautulliHistoryRowToPlexItem({
        media_type: 'movie',
        rating_key: 882002,
        title: 'A Sci-Fi Film',
        started: 1700000000,
        percent_complete: 100,
        watched_status: 1,
    })];
    const enriched = await enrichHistoryGenres(history, async (ratingKey) => {
        if (String(ratingKey) === '882002') return ['Science Fiction', 'Adventure'];
        return [];
    }, { skipCache: true });
    const stats = buildStatsFromHistoryItems(enriched);
    assert.equal(stats.genreMovies_scifi, 1);
    assert.equal(stats.genreMovies_adventure, 1);
});

test('localized and compound genre tags map onto canonical metrics', () => {
    const frenchMovie = {
        type: 'movie',
        ratingKey: 'fr-1',
        viewedAt: 1700000000,
        Genre: [{ tag: 'Comédie' }],
    };
    const compoundShow = {
        type: 'episode',
        ratingKey: 'ep-1',
        grandparentRatingKey: 'show-sf',
        viewedAt: 1700000000,
        Genre: [{ tag: 'Sci-Fi & Fantasy' }],
    };
    assert.deepEqual(extractCanonicalGenreIds(frenchMovie).sort(), ['comedy']);
    assert.deepEqual(extractCanonicalGenreIds(compoundShow).sort(), ['fantasy', 'scifi']);
    const stats = buildStatsFromHistoryItems([frenchMovie, compoundShow]);
    assert.equal(stats.genreMovies_comedy, 1);
    assert.equal(stats.genreShows_scifi, 1);
    assert.equal(stats.genreShows_fantasy, 1);
});

test('unmapped genre labels still get enriched from Plex metadata', async () => {
    const history = [{
        type: 'movie',
        ratingKey: '9001',
        viewedAt: 1700000000,
        Genre: [{ tag: 'Reality-TV' }],
    }];
    const lookedUp = [];
    const enriched = await enrichHistoryGenres(history, async (ratingKey) => {
        lookedUp.push(String(ratingKey));
        if (String(ratingKey) === '9001') return ['Documentary', 'Comedy'];
        return [];
    }, { skipCache: true });
    assert.deepEqual(lookedUp, ['9001']);
    const stats = buildStatsFromHistoryItems(enriched);
    assert.equal(stats.genreMovies_documentary, 1);
    assert.equal(stats.genreMovies_comedy, 1);
});

test('prefetch genre map applies even when live lookups are disabled', async () => {
    const history = [
        mapTautulliHistoryRowToPlexItem({
            media_type: 'movie',
            rating_key: 1001,
            title: 'Funny Movie',
            started: 1700000000,
            percent_complete: 100,
            watched_status: 1,
        }),
        mapTautulliHistoryRowToPlexItem({
            media_type: 'episode',
            rating_key: 2001,
            grandparent_rating_key: 3001,
            grandparent_title: 'Spooky Show',
            started: 1700000000,
            percent_complete: 100,
            watched_status: 1,
        }),
    ];
    let liveHits = 0;
    const enriched = await enrichHistoryGenres(history, async () => {
        liveHits += 1;
        return ['Should not run'];
    }, {
        skipCache: true,
        maxLookups: 0,
        prefetched: {
            1001: ['Comedy'],
            3001: ['Horror'],
        },
    });
    assert.equal(liveHits, 0);
    const stats = buildStatsFromHistoryItems(enriched);
    assert.equal(stats.genreMovies_comedy, 1);
    assert.equal(stats.genreShows_horror, 1);
});

test('buildPlexLibraryGenreMap walks movie and show sections', async () => {
    const fetchPlexJson = async (pathQuery) => {
        if (pathQuery === '/library/sections') {
            return {
                MediaContainer: {
                    Directory: [
                        { key: '1', type: 'movie' },
                        { key: '2', type: 'show' },
                        { key: '3', type: 'artist' },
                    ],
                },
            };
        }
        if (pathQuery.includes('/library/sections/1/all')) {
            return {
                MediaContainer: {
                    totalSize: 1,
                    Metadata: [{ ratingKey: '11', Genre: [{ tag: 'Comedy' }, { tag: 'Drama' }] }],
                },
            };
        }
        if (pathQuery.includes('/library/sections/2/all')) {
            return {
                MediaContainer: {
                    totalSize: 1,
                    Metadata: [{ ratingKey: '22', Genre: { tag: 'Horreur' } }],
                },
            };
        }
        throw new Error(`unexpected path ${pathQuery}`);
    };
    const map = await buildPlexLibraryGenreMap(fetchPlexJson);
    assert.deepEqual(map['11'], ['Comedy', 'Drama']);
    assert.deepEqual(map['22'], ['Horreur']);
});

test('stale genre snapshots rescore until enrichment version is stamped', () => {
    assert.equal(snapshotNeedsGenreRescore({
        stats: { uniqueMovies: 12, uniqueShows: 4, genreTagsSeen: 0 },
    }), true);
    assert.equal(snapshotNeedsGenreRescore({
        genreEnrichmentVersion: GENRE_ENRICHMENT_VERSION,
        stats: { uniqueMovies: 12, uniqueShows: 4, genreTagsSeen: 0 },
    }), false);
    assert.equal(snapshotNeedsGenreRescore({
        stats: { uniqueMovies: 0, uniqueShows: 0 },
    }), false);
});

test('isSeasonActive handles inclusive and cross-year windows', () => {
    assert.equal(isSeasonActive({ activeFrom: '10-01', activeUntil: '10-31' }, new Date('2026-10-15')), true);
    assert.equal(isSeasonActive({ activeFrom: '10-01', activeUntil: '10-31' }, new Date('2026-09-30')), false);
    assert.equal(isSeasonActive({ activeFrom: '12-15', activeUntil: '01-05' }, new Date('2026-12-20')), true);
    assert.equal(isSeasonActive({ activeFrom: '12-15', activeUntil: '01-05' }, new Date('2026-01-03')), true);
    assert.equal(isSeasonActive({ activeFrom: '12-15', activeUntil: '01-05' }, new Date('2026-02-01')), false);
    assert.equal(isSeasonActive({}, new Date('2026-06-01')), true);
});

test('seasonal badges only newly unlock while in season', () => {
    const stats = {
        genreMovies_horror: 5,
        uniqueMovies: 0,
        episodePlays: 0,
        activeDays: 0,
    };
    const inSeason = evaluateAchievements({
        stats,
        previousBadges: {},
        now: new Date('2026-10-20'),
    });
    assert.ok(inSeason.earned.some((b) => b.id === 'seasonal_halloween'));

    const outOfSeason = evaluateAchievements({
        stats,
        previousBadges: {},
        now: new Date('2026-03-01'),
    });
    assert.ok(!outOfSeason.earned.some((b) => b.id === 'seasonal_halloween'));

    const kept = evaluateAchievements({
        stats,
        previousBadges: {
            seasonal_halloween: { earnedAt: '2025-10-20T00:00:00.000Z' },
        },
        now: new Date('2026-03-01'),
    });
    assert.ok(kept.earned.some((b) => b.id === 'seasonal_halloween'));
});

test('admin seasons overlay gates and spotlights badge ids', () => {
    const seasons = [{
        id: 'spring',
        name: 'Spring',
        activeFrom: '03-01',
        activeUntil: '03-31',
        badgeIds: ['movies_10'],
        spotlight: true,
    }];
    assert.equal(
        isBadgeSeasonActive({ id: 'movies_10' }, new Date('2026-03-15'), seasons),
        true,
    );
    assert.equal(
        isBadgeSeasonActive({ id: 'movies_10' }, new Date('2026-04-02'), seasons),
        false,
    );
    // Unlisted badges keep their own seasonal window (none = always active).
    assert.equal(
        isBadgeSeasonActive({ id: 'movies_25' }, new Date('2026-04-02'), seasons),
        true,
    );
    const spotlight = listActiveSpotlightSeasons(seasons, new Date('2026-03-10'));
    assert.equal(spotlight.length, 1);
    assert.equal(spotlight[0].id, 'spring');
    assert.equal(listActiveSpotlightSeasons(seasons, new Date('2026-05-01')).length, 0);
});

test('estimateUnlockTimestamps uses the play that crossed the threshold', () => {
    const history = [];
    for (let i = 0; i < 12; i += 1) {
        history.push({
            type: 'movie',
            ratingKey: `m${i}`,
            // 10th movie (0-based index 9) crosses movies_10
            viewedAt: 1_700_000_000 + i * 86400,
            librarySectionID: 1,
        });
    }
    const unlocks = estimateUnlockTimestamps(history);
    assert.ok(unlocks.movies_10);
    assert.equal(Date.parse(unlocks.movies_10), (1_700_000_000 + 9 * 86400) * 1000);
});

test('evaluateAchievements prefers historic unlock time over now', () => {
    const stats = { uniqueMovies: 12, moviePlays: 12 };
    const historic = '2024-06-01T12:00:00.000Z';
    const result = evaluateAchievements({
        stats,
        previousBadges: {},
        now: new Date('2026-08-10T12:00:00.000Z'),
        unlockTimestamps: { movies_10: historic },
    });
    const badge = result.earned.find((b) => b.id === 'movies_10');
    assert.ok(badge);
    assert.equal(badge.earnedAt, historic);
});

test('evaluateAchievements repairs bulk-stamped earnedAt from history', () => {
    const bulk = '2026-08-09T18:00:00.000Z';
    const historic = '2023-01-15T08:00:00.000Z';
    const result = evaluateAchievements({
        stats: { totalPlays: 800 },
        previousBadges: {
            plays_800: { earnedAt: bulk },
        },
        now: new Date('2026-08-10T12:00:00.000Z'),
        unlockTimestamps: { plays_800: historic },
    });
    const badge = result.badgeResults.find((b) => b.id === 'plays_800');
    assert.ok(badge?.earned);
    assert.equal(badge.earnedAt, historic);
    assert.ok(!result.newlyEarnedIds.includes('plays_800'));
});

test('forceUnlockTimestamps overwrites stored earnedAt even when history is later', () => {
    const stored = '2023-05-26T00:00:00.000Z';
    const historic = '2024-01-10T12:00:00.000Z';
    const soft = evaluateAchievements({
        stats: { uniqueMovies: 500, moviePlays: 500 },
        previousBadges: { movies_500: { earnedAt: stored } },
        unlockTimestamps: { movies_500: historic },
        forceUnlockTimestamps: false,
    });
    assert.equal(soft.badgeResults.find((b) => b.id === 'movies_500')?.earnedAt, stored);

    const forced = evaluateAchievements({
        stats: { uniqueMovies: 500, moviePlays: 500 },
        previousBadges: { movies_500: { earnedAt: stored } },
        unlockTimestamps: { movies_500: historic },
        forceUnlockTimestamps: true,
    });
    assert.equal(forced.badgeResults.find((b) => b.id === 'movies_500')?.earnedAt, historic);
    assert.ok(!forced.newlyEarnedIds.includes('movies_500'));
});
test('who-unlocked-first ordering follows historic times', () => {
    const early = estimateUnlockTimestamps(
        Array.from({ length: 800 }, (_, i) => ({
            type: 'episode',
            grandparentKey: 'show',
            viewedAt: 1_600_000_000 + i * 60,
        })),
    );
    const late = estimateUnlockTimestamps(
        Array.from({ length: 800 }, (_, i) => ({
            type: 'episode',
            grandparentKey: 'show',
            viewedAt: 1_700_000_000 + i * 60,
        })),
    );
    assert.ok(early.plays_800);
    assert.ok(late.plays_800);
    assert.ok(Date.parse(early.plays_800) < Date.parse(late.plays_800));
});

test('buildMemberDossier ranks first unlocks and rivals', async () => {
    const { buildMemberDossier, applyRankTrace } = await import('./memberDossier.js');
    const state = {
        users: {
            a: {
                accountId: 'a',
                username: 'alpha',
                xp: 5000,
                level: 20,
                earnedCount: 2,
                badges: {
                    movies_10: { earnedAt: '2024-01-01T00:00:00.000Z' },
                    plays_100: { earnedAt: '2024-02-01T00:00:00.000Z' },
                },
                stats: { uniqueMovies: 12, moviePlays: 12, totalPlays: 100 },
            },
            b: {
                accountId: 'b',
                username: 'bravo',
                xp: 4000,
                level: 18,
                earnedCount: 1,
                badges: {
                    movies_10: { earnedAt: '2024-06-01T00:00:00.000Z' },
                },
                stats: { uniqueMovies: 11, moviePlays: 11, totalPlays: 80 },
            },
            c: {
                accountId: 'c',
                username: 'charlie',
                xp: 3000,
                level: 15,
                earnedCount: 1,
                badges: {
                    plays_100: { earnedAt: '2023-01-01T00:00:00.000Z' },
                },
                stats: { uniqueMovies: 5, moviePlays: 5, totalPlays: 120 },
            },
        },
    };
    applyRankTrace(state, ['a', 'b', 'c']);
    // Simulate a drop for alpha
    state.users.a.boardRankPrevious = 1;
    state.users.a.boardRank = 1;
    const dossier = buildMemberDossier(state, { accountId: 'a', viewerAccountId: 'a' });
    assert.equal(dossier.rank, 1);
    assert.equal(dossier.firstUnlocks.count, 1); // movies_10 first; plays_100 owned by c earlier
    assert.equal(dossier.rivals.below.username, 'bravo');
    assert.ok(dossier.lastBadge);
    assert.ok(dossier.trophyCase.length >= 1);
    assert.equal(dossier.classTitle.id, 'sovereign');
});

test('achievement identity strips parenthetical suffixes', async () => {
    const { achievementIdentityKey } = await import('./identity.js');
    assert.equal(achievementIdentityKey({ username: '_iDrink' }), '_idrink');
    assert.equal(achievementIdentityKey({ username: '_iDrink (viewer)' }), '_idrink');
    assert.equal(achievementIdentityKey({ username: '  _iDrink (Plex Home)  ' }), '_idrink');
    assert.equal(achievementIdentityKey({ accountId: '99' }), 'id:99');
});

test('dedupeAchievementSnapshots collapses username aliases and matching thumbs', async () => {
    const { achievementIdentityKey, dedupeAchievementSnapshots } = await import('./identity.js');
    const rows = dedupeAchievementSnapshots([
        { accountId: '222', username: '_iDrink (viewer)', xp: 800, earnedCount: 4, thumb: 'https://plex.tv/users/abc/avatar' },
        { accountId: '111', username: '_iDrink', xp: 1200, earnedCount: 8, thumb: 'https://plex.tv/users/abc/avatar' },
        { accountId: '333', username: 'other', xp: 400, earnedCount: 2, thumb: 'https://plex.tv/users/zzz/avatar' },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => achievementIdentityKey(row) === '_idrink').accountId, '111');
    assert.ok(rows.some((row) => row.accountId === '333'));

    const byThumb = dedupeAchievementSnapshots([
        { accountId: '9', username: 'Alias One', xp: 10, thumb: 'https://plex.tv/users/same/avatar' },
        { accountId: '8', username: 'Alias Two', xp: 50, thumb: 'https://plex.tv/users/same/avatar' },
    ]);
    assert.equal(byThumb.length, 1);
    assert.equal(byThumb[0].accountId, '8');
});

test('pruneAchievementAliasSnapshots drops leftover ids for the same person', async () => {
    const { pruneAchievementAliasSnapshots } = await import('./identity.js');
    const pruned = pruneAchievementAliasSnapshots({
        1: { accountId: '1', username: 'admin', xp: 500, earnedCount: 5 },
        999999: { accountId: '999999', username: 'admin', xp: 40, earnedCount: 1 },
        111: { accountId: '111', username: '_iDrink', xp: 1200, earnedCount: 8 },
        222: { accountId: '222', username: '_iDrink (viewer)', xp: 800, earnedCount: 4 },
        333: { accountId: '333', username: 'other', xp: 400, earnedCount: 2 },
    }, {
        targets: [
            { accountId: '1', username: 'admin' },
            { accountId: '111', username: '_iDrink' },
            { accountId: '333', username: 'other' },
        ],
        portalUsers: [
            { id: '1', plexId: '999999', plexAccountId: '1', username: 'admin' },
            { id: 'u1', plexAccountId: '111', plexId: '222', username: '_iDrink' },
        ],
        adminPlexId: '999999',
    });
    assert.deepEqual(Object.keys(pruned).sort(), ['1', '111', '333']);
});

test('resolvePortalAchievementTargets keeps one mapping per display name', async () => {
    const { resolvePortalAchievementTargets } = await import('./backfill.js');
    const targets = resolvePortalAchievementTargets([
        { username: '_iDrink (viewer)', plexAccountId: '222' },
        { username: '_iDrink', plexAccountId: '111' },
        { username: 'other', plexAccountId: '333' },
    ], {
        plexAccounts: [{ id: '111', name: '_iDrink' }, { id: '222', name: '_iDrink' }, { id: '333', name: 'other' }],
    });
    assert.equal(targets.length, 2);
    assert.equal(targets.find((row) => row.username === '_iDrink').accountId, '111');
    assert.ok(targets.some((row) => row.accountId === '333'));
});

test('buildLeaderboard hides duplicate ranking rows immediately', async () => {
    const { buildLeaderboard } = await import('./store.js');
    const board = buildLeaderboard({
        users: {
            222: { accountId: '222', username: '_iDrink (viewer)', xp: 800, earnedCount: 4, thumb: 'https://plex.tv/users/abc/avatar' },
            111: { accountId: '111', username: '_iDrink', xp: 1200, earnedCount: 8, thumb: 'https://plex.tv/users/abc/avatar' },
            333: { accountId: '333', username: 'other', xp: 400, earnedCount: 2 },
        },
    }, { limit: 50 });
    assert.equal(board.length, 2);
    assert.equal(board[0].username, '_iDrink');
    assert.equal(board[0].rank, 1);
    assert.equal(board[1].username, 'other');
});

test('backfill skip vs force: recent runs stay skipped unless forced', async () => {
    const { achievementsBackfillNeedsWork, summarizeAchievementsBackfill } = await import('./backfill.js');
    const now = Date.now();
    assert.equal(achievementsBackfillNeedsWork({
        force: false,
        lastCompletedAt: now,
        missingCount: 0,
        sourceChanged: false,
    }), false);
    assert.equal(achievementsBackfillNeedsWork({
        force: true,
        lastCompletedAt: now,
        missingCount: 0,
        sourceChanged: false,
    }), true);
    assert.equal(achievementsBackfillNeedsWork({
        force: false,
        lastCompletedAt: now,
        missingCount: 3,
        sourceChanged: false,
    }), true);
    assert.equal(achievementsBackfillNeedsWork({
        force: false,
        lastCompletedAt: 0,
        missingCount: 0,
        sourceChanged: false,
    }), true);
    assert.match(
        summarizeAchievementsBackfill({ ok: true, skipped: true, reason: 'fresh' }) || '',
        /already current/i,
    );
    assert.match(
        summarizeAchievementsBackfill({ ok: true, processed: 12, historySource: 'plex' }) || '',
        /Scored 12/,
    );
});

test('watch time awards 1 XP per minute and stretches the level curve', async () => {
    const { computeXpBreakdown, normalizeXpWeights, levelFromXp, xpForLevel, XP_CURVE_K } = await import('./xp.js');
    const { xp, parts } = computeXpBreakdown({ minutesWatched: 90, hoursWatched: 1.5 });
    assert.equal(parts.minutesWatched, 90);
    assert.equal(parts.hoursWatched, 0);
    assert.equal(xp, 90);

    const fromHoursOnly = computeXpBreakdown({ hoursWatched: 2 });
    assert.equal(fromHoursOnly.parts.minutesWatched, 120);

    const migrated = normalizeXpWeights({ hoursWatched: 6, uniqueMovies: 20 });
    assert.equal(migrated.minutesWatched, 1);
    assert.equal(migrated.hoursWatched, 0);
    assert.equal(migrated.dailyWatches, 40);
    assert.equal(migrated.activeDays, 0);

    assert.equal(XP_CURVE_K, 250);
    assert.equal(xpForLevel(1), 0);
    assert.equal(xpForLevel(2), 250);
    assert.equal(levelFromXp(0), 1);
    assert.equal(levelFromXp(249), 1);
    assert.equal(levelFromXp(250), 2);
    assert.ok(xpForLevel(31) - xpForLevel(30) > 10000);
});

test('finish, daily, binge, Sunday, request, and badge XP all pay out', async () => {
    const { computeXpBreakdown, computeBadgeUnlockXp, BADGE_RARITY_XP } = await import('./xp.js');
    const { countMediaRequestsForIdentity } = await import('./requestCounts.js');
    const sunday = Math.floor(Date.UTC(2026, 0, 4, 15, 0, 0) / 1000); // Sunday
    const monday = Math.floor(Date.UTC(2026, 0, 5, 15, 0, 0) / 1000); // Monday

    const stats = buildStatsFromHistoryItems([
        {
            type: 'movie',
            ratingKey: 'finished-movie',
            viewedAt: sunday,
            duration: 120 * 60 * 1000,
            percentComplete: 100,
            watchedStatus: 1,
        },
        {
            type: 'movie',
            ratingKey: 'abandoned-movie',
            viewedAt: monday,
            duration: 120 * 60 * 1000,
            percentComplete: 20,
        },
        ...[0, 1, 2].map((i) => ({
            type: 'episode',
            ratingKey: `ep-${i}`,
            grandparentKey: 'show-binge',
            viewedAt: monday + i * 1800,
            duration: 24 * 60 * 1000,
            percentComplete: 100,
        })),
    ], { timeZone: 'UTC' });

    assert.equal(stats.movieFinishes, 1);
    assert.equal(stats.episodeFinishes, 3);
    assert.equal(stats.dailyWatches, 2);
    assert.equal(stats.bingeSessions, 1);
    assert.equal(stats.sundayMinutes, 120);
    assert.ok(stats.minutesWatched >= 120);

    const { parts } = computeXpBreakdown({
        ...stats,
        mediaRequests: 2,
        badgeUnlockXp: 0,
    });
    assert.equal(parts.movieFinishes, 40);
    assert.equal(parts.episodeFinishes, 30);
    assert.equal(parts.dailyWatches, 80);
    assert.equal(parts.bingeSessions, 30);
    assert.equal(parts.sundayMinutes, 120);
    assert.equal(parts.mediaRequests, 30);
    assert.equal(parts.minutesWatched, stats.minutesWatched);

    const incompleteOnly = buildStatsFromHistoryItems([{
        type: 'movie',
        ratingKey: 'skip',
        viewedAt: monday,
        duration: 90 * 60 * 1000,
        percentComplete: 15,
    }], { timeZone: 'UTC' });
    assert.equal(incompleteOnly.movieFinishes, 0);
    assert.equal(incompleteOnly.moviePlays, 1);

    const requestCount = countMediaRequestsForIdentity([
        { userId: 'u1', title: 'Dune' },
        { userId: 'u2', title: 'Nope' },
        { userId: '99', meta: { requestedByEmail: 'sam@example.com' } },
    ], { portalUserId: 'u1', email: 'sam@example.com' });
    assert.equal(requestCount, 2);

    const badgeXp = computeBadgeUnlockXp([
        { rarity: 'common' },
        { rarity: 'rare' },
        { rarity: 'legendary', revokedAt: '2026-01-01' },
    ], 1);
    assert.equal(badgeXp, BADGE_RARITY_XP.common + BADGE_RARITY_XP.rare);

    const evaluated = evaluateAchievements({
        stats: buildStatsFromHistoryItems([{
            type: 'movie',
            ratingKey: 'first',
            viewedAt: monday,
            percentComplete: 100,
        }], { timeZone: 'UTC' }),
        previousBadges: {},
    });
    assert.ok(evaluated.breakdown.badgeUnlocks >= BADGE_RARITY_XP.common);
    assert.ok(evaluated.earned.some((b) => b.id === 'movies_1'));
});

test('earned ladder floors later-tier progress when live metric is 0', () => {
    const result = evaluateAchievements({
        stats: { libraryDiversity: 0 },
        previousBadges: {
            libs_2: { earnedAt: '2024-01-01T00:00:00.000Z' },
            libs_3: { earnedAt: '2024-01-01T00:00:00.000Z' },
            libs_4: { earnedAt: '2024-01-01T00:00:00.000Z' },
            libs_5: { earnedAt: '2024-01-01T00:00:00.000Z' },
        },
    });
    const earnedNomad = result.badgeResults.find((b) => b.id === 'libs_5');
    const nextExplorer = result.badgeResults.find((b) => b.id === 'libs_6');
    const cartographer = result.badgeResults.find((b) => b.id === 'libs_8');
    assert.equal(earnedNomad?.earned, true);
    assert.equal(earnedNomad?.progressPct, 100);
    assert.equal(nextExplorer?.earned, false);
    assert.equal(nextExplorer?.progress, 5);
    assert.equal(nextExplorer?.progressPct, Math.round((5 / 6) * 100));
    assert.equal(cartographer?.progress, 5);
    assert.equal(cartographer?.progressPct, Math.round((5 / 8) * 100));
});

