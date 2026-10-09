import assert from 'node:assert/strict';
import test from 'node:test';
import {
    actorQueryValues,
    studioQueryValues,
    expandStudioQueryValues,
    studioNamesMatch,
    buildPlexTimelineParams,
    clampPlayOffsetMs,
    isAllowedPlexProxyUrl,
    isPlaySessionId,
    mapContinueWatchingItem,
    isLibraryContinueWatchingHub,
    assembleLibraryHomeHubs,
    dedupeLibraryContinueWatchingHubs,
    withMemberContinueWatching,
    mapPlayerExtras,
    listPlayerExtraMetas,
    mapPlayerHubs,
    mapPlayerHomeHubs,
    mergeSameTitleHomeHubs,
    isRandomOrderSource,
    collectionRatingKeyFromHub,
    isHeroRowLabel,
    plexHeroUuidFromMeta,
    coverArtUrlFromProvider,
    heroAssetsFromProvider,
    collectionMetaHasHeroLabel,
    markHeroCollectionHubs,
    playlistRatingKeyFromHub,
    mapPlayerItem,
    plexViewOffsetMs,
    mapPlayerItemDetails,
    applyShowMetaToPlayerChild,
    pickPersonThumb,
    pickPlayerLogo,
    pickPlayerThumb,
    pickPlayerThemeKey,
    pickPlayerThemePath,
    isPlayerThemePath,
    buildPlayerThemeSrc,
    safePlayerAvatarUrl,
    mapPlayerProfile,
    mapPlayerMediaInfo,
    mapPlayerPlaybackMode,
    mapPlayerPlaybackOptions,
    mapPlayerPlaylist,
    mapPlayerRatings,
    mapRecentlyAddedItem,
    mapLibraryHubItem,
    pickMediaIndex,
    applyHomeRowOrder,
    applyLibraryNavOrder,
    applyLibraryNavOrderToHubs,
    classifyPlayerHomeHub,
    defaultHomeRowIds,
    collapseHomeRowOrder,
    normalizeHomeRowOrder,
    normalizeLibraryNavOrder,
    normalizePlayerSettings,
    pickPlayerAudioStreamId,
    pickPlayerSubtitleStreamId,
    playerLanguageMatches,
    plexPlaylistUri,
    resolvePlayOffsetMs,
    withSelectedMedia,
    normalizePlaybackCaps,
    canHttpDirectPlay,
    nextEpisodeInList,
    previousEpisodeInList,
    pickPersonFromMetadata,
    mapPlayerPersonSearchHit,
    isPlexPersonSearchHit,
    isPlexPeopleSearchHub,
    pickPlayerTmdbId,
    pickPlayerShowTmdbId,
    rewritePlaylistUrls,
    rewritePlexUrlToOrigin,
    transcodeSettingsForQuality,
    buildPlayerFileSrc,
    buildPlayerHlsSrc,
    buildPlayerHlsFallbackSrc,
    withPlaybackAccessToken,
    playbackCapsFromRequest,
    collectionChildItems,
    collectionChildPaths,
    safePlexLibraryPath,
    withPlexContainerParams,
} from './mapItem.js';

test('mapPlayerItem marks movies and episodes as playable', () => {
    const movie = mapPlayerItem({ ratingKey: '12', title: 'Heat', type: 'movie', year: 1995 });
    assert.equal(movie.canPlay, true);
    assert.equal(movie.year, 1995);
    const show = mapPlayerItem({ ratingKey: '9', title: 'The Wire', type: 'show' });
    assert.equal(show.canPlay, true);
    const episode = mapPlayerItem({
        ratingKey: '44',
        title: 'The Target',
        type: 'episode',
        grandparentTitle: 'The Wire',
        parentIndex: 1,
        index: 1,
    });
    assert.equal(episode.canPlay, true);
    assert.equal(episode.showTitle, 'The Wire');
    const withFile = mapPlayerItem({
        ratingKey: '45',
        title: 'The Detail',
        type: 'episode',
        Media: [{ videoResolution: '1080', videoCodec: 'h264', audioCodec: 'aac', height: 1080 }],
    });
    assert.equal(withFile.versions[0].resolution, '1080p');
    const interlaced = mapPlayerItem({
        ratingKey: '46',
        title: 'Broadcast',
        type: 'episode',
        Media: [{
            videoResolution: '1080',
            videoCodec: 'h264',
            audioCodec: 'ac3',
            height: 1080,
            Part: [{ Stream: [{ streamType: 1, scanType: 'interlaced', codec: 'h264' }] }],
        }],
    });
    assert.equal(interlaced.versions[0].resolution, '1080i');
    assert.equal(withFile.versions[0].videoCodec, 'h264');
    assert.equal(withFile.versions[0].audioCodec, 'aac');
    const season = mapPlayerItem({
        ratingKey: '8',
        title: 'Season 1',
        type: 'season',
        parentTitle: 'The Wire',
        parentRatingKey: '9',
    });
    assert.equal(season.showTitle, 'The Wire');
    assert.equal(season.seasonTitle, 'Season 1');
    assert.equal(season.parentRatingKey, '9');
});

test('mapPlayerItem marks albums, artists, and tracks as playable music', () => {
    const artist = mapPlayerItem({ ratingKey: '80', title: 'Radiohead', type: 'artist' });
    assert.equal(artist.canPlay, true);
    const album = mapPlayerItem({
        ratingKey: '81',
        title: 'OK Computer',
        type: 'album',
        parentTitle: 'Radiohead',
        year: 1997,
    });
    assert.equal(album.canPlay, true);
    assert.equal(album.showTitle, 'Radiohead');
    const track = mapPlayerItem({
        ratingKey: '82',
        title: 'Paranoid Android',
        type: '10',
        grandparentTitle: 'Radiohead',
        parentTitle: 'OK Computer',
        index: 2,
        duration: 383000,
    });
    assert.equal(track.type, 'track');
    assert.equal(track.canPlay, true);
    assert.equal(track.showTitle, 'Radiohead');
    assert.equal(track.seasonTitle, 'OK Computer');
    assert.equal(track.index, 2);
});

test('recently added TV keeps the episode key with a show poster and next-episode walks the season', () => {
    const added = mapRecentlyAddedItem({
        ratingKey: '44',
        title: 'The Target',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'The Wire',
        grandparentThumb: '/library/metadata/9/thumb',
        thumb: '/library/metadata/44/thumb',
    }, { type: 'show' });
    assert.equal(added.ratingKey, '44');
    assert.equal(added.title, 'The Wire');
    assert.equal(added.type, 'episode');
    assert.equal(added.showTitle, 'The Wire');
    assert.equal(added.thumb, '/library/metadata/9/thumb');
    assert.equal(added.cardAspect, '2/3');
    assert.equal(added.dedupeKey, '9');
    assert.equal(added.canPlay, true);
    const noShowArt = mapRecentlyAddedItem({
        ratingKey: '44',
        title: 'The Target',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'The Wire',
        thumb: '/library/metadata/44/thumb',
    }, { type: 'show' });
    assert.equal(noShowArt.thumb, '/library/metadata/9/thumb');
    const hubAdded = mapLibraryHubItem({
        ratingKey: '44',
        title: 'The Target',
        type: 'episode',
        grandparentRatingKey: '9',
        grandparentTitle: 'The Wire',
        grandparentThumb: '/library/metadata/9/thumb',
    }, { hubIdentifier: 'tv.recentlyadded' });
    assert.equal(hubAdded.ratingKey, '44');
    assert.equal(hubAdded.title, 'The Wire');
    assert.equal(hubAdded.type, 'episode');
    assert.equal(hubAdded.cardAspect, '2/3');
    const collection = mapPlayerItem({ ratingKey: '80', title: 'Neo-noir', type: 'collection', childCount: 12 });
    assert.equal(collection.canPlay, false);
    assert.equal(collection.childCount, 12);
    const next = nextEpisodeInList([
        { ratingKey: '44' },
        { ratingKey: '45' },
        { ratingKey: '46' },
    ], '44');
    assert.equal(next.ratingKey, '45');
    assert.equal(nextEpisodeInList([{ ratingKey: '46' }], '46'), null);
    assert.equal(previousEpisodeInList([
        { ratingKey: '44' },
        { ratingKey: '45' },
        { ratingKey: '46' },
    ], '46').ratingKey, '45');
    assert.equal(previousEpisodeInList([{ ratingKey: '44' }], '44'), null);
});

test('mapPlayerItem maps cast and crew without file paths', () => {
    const movie = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        studio: 'Warner Bros.',
        tagline: 'A Los Angeles crime saga',
        Director: [{ tag: 'Michael Mann' }],
        Writer: [{ tag: 'Michael Mann' }],
        Role: [
            { id: 1, tag: 'Al Pacino', role: 'Vincent Hanna', thumb: '/library/metadata/1/thumb' },
            { id: 2, tag: 'Robert De Niro', role: 'Neil McCauley' },
        ],
        Media: [{ Part: [{ file: '/secrets/heat.mkv' }] }],
    });
    assert.equal(movie.studio, 'Warner Bros.');
    assert.equal(movie.studioKey, 'Warner Bros.');
    assert.equal(movie.tagline, 'A Los Angeles crime saga');
    assert.deepEqual(movie.directors, ['Michael Mann']);
    assert.equal(movie.directorPeople[0].name, 'Michael Mann');
    assert.deepEqual(movie.countries, []);
    assert.equal(movie.cast[0].id, '1');
    assert.equal(movie.cast[0].name, 'Al Pacino');
    assert.equal(movie.cast[0].role, 'Vincent Hanna');
    assert.equal(movie.cast[0].thumb, '/library/metadata/1/thumb');
    assert.equal(JSON.stringify(movie).includes('/secrets/heat.mkv'), false);
    const detailed = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Country: [{ tag: 'United States' }],
        Collection: [{ tag: 'Crime Classics' }],
        Producer: [{ id: 9, tag: 'Art Linson' }],
        lastViewedAt: 1700000000,
        originallyAvailableAt: '1995-12-15',
    });
    assert.deepEqual(detailed.countries, ['United States']);
    assert.deepEqual(detailed.collections, ['Crime Classics']);
    assert.deepEqual(detailed.collectionItems, [{ ratingKey: '', title: 'Crime Classics' }]);
    const withCollectionLink = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Collection: [{ id: 831577, filter: 'collection=831577', tag: 'Crime Classics' }],
        Studio: [{ id: 44, filter: 'studio=44', tag: 'Warner Bros.' }],
        librarySectionID: 6,
    });
    assert.deepEqual(withCollectionLink.collectionItems, [{ ratingKey: '831577', title: 'Crime Classics' }]);
    assert.equal(withCollectionLink.studio, 'Warner Bros.');
    assert.equal(withCollectionLink.studioKey, '44');
    assert.equal(withCollectionLink.librarySectionID, '6');
    assert.equal(detailed.producers[0].name, 'Art Linson');
    assert.equal(detailed.lastViewedAt, 1700000000);
});

test('playback options map quality audio and subtitles without file paths', () => {
    const meta = {
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Media: [{
            videoResolution: '4k',
            width: 3840,
            height: 2160,
            Part: [{
                file: '/secrets/heat.mkv',
                Stream: [
                    { id: 10, streamType: 1, height: 2160, width: 3840, codec: 'hevc' },
                    {
                        id: 20,
                        streamType: 2,
                        selected: true,
                        codec: 'eac3',
                        channels: 6,
                        language: 'English',
                        displayTitle: 'English (EAC3 5.1)',
                    },
                    { id: 21, streamType: 2, codec: 'aac', channels: 2, language: 'English', displayTitle: 'English (AAC Stereo)' },
                    { id: 30, streamType: 3, codec: 'srt', language: 'English', displayTitle: 'English (SRT)' },
                    { id: 31, streamType: 3, codec: 'srt', language: 'Spanish', displayTitle: 'Spanish (SRT)', selected: true },
                ],
            }],
        }],
    };
    const options = mapPlayerPlaybackOptions(meta);
    assert.equal(options.qualityId, 'original');
    assert.equal(options.qualities[0].id, 'original');
    assert.equal(options.qualities.some((row) => row.id === '1080-12'), true);
    assert.equal(options.qualities.some((row) => row.label.includes('4k')), false);
    assert.equal(options.audioStreamId, '20');
    assert.equal(options.audioTracks.length, 2);
    assert.equal(options.audioTracks[1].label, 'English (AAC Stereo)');
    assert.equal(options.subtitleStreamId, null);
    assert.equal(options.subtitles[0].label, 'English (SRT)');
    assert.equal(JSON.stringify(options).includes('/secrets/heat.mkv'), false);
    const forcedSubs = mapPlayerPlaybackOptions({
        Media: [{
            Part: [{
                Stream: [
                    { id: 1, streamType: 1, height: 1080, codec: 'h264' },
                    { id: 40, streamType: 3, codec: 'srt', forced: true },
                    { id: 41, streamType: 3, codec: 'srt', selected: true },
                ],
            }],
        }],
    });
    assert.equal(forcedSubs.subtitleStreamId, '40');
    const sevenTwenty = mapPlayerPlaybackOptions({
        Media: [{ height: 720, videoResolution: '720', Part: [{ Stream: [{ id: 1, streamType: 1, height: 720 }] }] }],
    });
    assert.equal(sevenTwenty.qualities.some((row) => row.id.startsWith('1080')), false);
    assert.equal(sevenTwenty.qualityId, 'original');
    const originalAttempts = transcodeSettingsForQuality('original');
    assert.equal(originalAttempts[0].directPlay, '0');
    assert.equal(originalAttempts[0].directStream, '1');
    assert.equal(originalAttempts[0].directStreamAudio, '1');
    assert.equal(originalAttempts[0].copy, true);
    assert.equal(originalAttempts[1].directStreamAudio, '0');
    assert.equal(originalAttempts[1].audioCodec, 'aac');
    assert.equal(originalAttempts.at(-1).directStream, '0');
    const attempts = transcodeSettingsForQuality('1080-12');
    assert.equal(attempts[0].videoResolution, '1920x1080');
    assert.equal(attempts[0].directStream, '0');
    assert.equal(attempts[0].directStreamAudio, '0');
    assert.equal(attempts[1].videoResolution, '1280x720');
    const retarget = buildPlayerHlsSrc('12', {
        sessionId: '22222222-2222-4222-8222-222222222222',
        offsetMs: 125000,
        qualityId: '720-4',
        audioStreamId: '21',
        subtitleStreamId: '31',
    });
    assert.match(retarget, /session=22222222-2222-4222-8222-222222222222/);
    assert.match(retarget, /offset=125000/);
    assert.equal(retarget.includes('11111111-1111-4111-8111-111111111111'), false);
    const src = buildPlayerHlsSrc('12', {
        sessionId: '11111111-1111-4111-8111-111111111111',
        offsetMs: 80000,
        qualityId: '720-4',
        audioStreamId: '20',
        subtitleStreamId: '30',
        resume: true,
    });
    assert.match(src, /quality=720-4/);
    assert.match(src, /audioStreamID=20/);
    assert.match(src, /subtitleStreamID=30/);
    assert.match(src, /resume=1/);
    assert.equal(buildPlayerHlsSrc('12', { qualityId: '../etc/passwd' }).includes('quality='), false);
    assert.match(buildPlayerHlsSrc('12', { qualityId: 'original' }), /quality=original/);
});

test('HTTP Direct Play is only offered for browser-safe MP4 files', () => {
    const mp4 = {
        Media: [{
            container: 'mp4',
            videoCodec: 'h264',
            audioCodec: 'aac',
            Part: [{
                id: 99,
                container: 'mp4',
                Stream: [
                    { streamType: 1, codec: 'h264', height: 1080 },
                    { streamType: 2, codec: 'aac', selected: true },
                ],
            }],
        }],
    };
    assert.equal(canHttpDirectPlay(mp4), true);
    assert.equal(canHttpDirectPlay(mp4, { subtitleStreamId: '31' }), false);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mkv',
            videoCodec: 'h264',
            Part: [{ id: 1, container: 'mkv', Stream: [{ streamType: 1, codec: 'h264' }, { streamType: 2, codec: 'aac' }] }],
        }],
    }), false);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mp4',
            videoCodec: 'hevc',
            Part: [{ id: 1, container: 'mp4', Stream: [{ streamType: 1, codec: 'hevc' }, { streamType: 2, codec: 'aac' }] }],
        }],
    }), false);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mp4',
            videoCodec: 'hevc',
            Part: [{ id: 1, container: 'mp4', Stream: [{ streamType: 1, codec: 'hevc' }, { streamType: 2, codec: 'aac' }] }],
        }],
    }, { allowHevc: true }), true);
    const mkv = {
        Media: [{
            container: 'mkv',
            videoCodec: 'hevc',
            audioCodec: 'truehd',
            Part: [{
                id: 7,
                container: 'mkv',
                Stream: [
                    { streamType: 1, codec: 'hevc' },
                    { streamType: 2, codec: 'truehd', selected: true },
                    { streamType: 3, codec: 'srt', id: 40 },
                ],
            }],
        }],
    };
    assert.equal(canHttpDirectPlay(mkv), false);
    // Android TV Direct Plays TrueHD for HDMI bitstream/passthrough. SRT can ride along.
    assert.equal(canHttpDirectPlay(mkv, { client: 'android', subtitleStreamId: '40' }), true);
    assert.equal(canHttpDirectPlay(mkv, { client: 'android' }), true);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mkv',
            videoCodec: 'h264',
            Part: [{ id: 8, container: 'mkv', Stream: [{ streamType: 1, codec: 'h264' }, { streamType: 2, codec: 'aac', selected: true }] }],
        }],
    }, { client: 'android' }), true);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'flac',
            audioCodec: 'flac',
            Part: [{ id: 88, container: 'flac', Stream: [{ streamType: 2, codec: 'flac', selected: true }] }],
        }],
    }, { client: 'android' }), true);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mkv',
            videoCodec: 'hevc',
            Part: [{ id: 9, container: 'mkv', Stream: [{ streamType: 1, codec: 'hevc' }, { streamType: 2, codec: 'eac3', selected: true }] }],
        }],
    }, { client: 'android' }), true);
    assert.equal(canHttpDirectPlay({
        Media: [{
            container: 'mkv',
            videoCodec: 'hevc',
            audioCodec: 'truehd',
            Part: [{
                id: 7,
                container: 'mkv',
                Stream: [
                    { streamType: 1, codec: 'hevc' },
                    { streamType: 2, codec: 'truehd', selected: true },
                    { streamType: 3, codec: 'pgs', id: 41 },
                ],
            }],
        }],
    }, { client: 'android', subtitleStreamId: '41' }), false);
    assert.equal(canHttpDirectPlay(mkv, { client: 'ios', canPlayHevc: false }), false);
    assert.equal(normalizePlaybackCaps({ client: 'android' }).client, 'android');
    assert.equal(normalizePlaybackCaps({ client: 'android' }).textSubtitles, true);
    assert.equal(normalizePlaybackCaps({ canPlayHevc: 'true' }).allowHevc, true);
    assert.equal(normalizePlaybackCaps({ canPlayHevc: 'false' }).allowHevc, false);
    assert.match(buildPlayerFileSrc('12', { client: 'android', sessionId: '11111111-1111-1111-1111-111111111111' }), /client=android/);
    assert.match(buildPlayerHlsSrc('12', { qualityId: 'original', copy: false }), /copy=0/);
    assert.equal(JSON.stringify(mp4.Media[0].Part[0]).includes('file'), false);
});

test('Direct Play on Android can bitstream TrueHD or pick a requested AAC track', () => {
    const mkv = {
        Media: [{
            container: 'mkv',
            videoCodec: 'hevc',
            audioCodec: 'truehd',
            Part: [{
                id: 7,
                container: 'mkv',
                Stream: [
                    { streamType: 1, codec: 'hevc' },
                    { streamType: 2, codec: 'truehd', selected: true, id: 20 },
                    { streamType: 2, codec: 'aac', id: 21 },
                ],
            }],
        }],
    };
    assert.equal(canHttpDirectPlay(mkv, { client: 'android' }), true);
    assert.equal(canHttpDirectPlay(mkv, { client: 'android', audioStreamID: '21' }), true);
    assert.equal(playbackCapsFromRequest({
        query: {},
        headers: { 'user-agent': 'StreamPilot-MediaPlayer/1.0 (Android TV; ExoPlayer)' },
    }).client, 'android');
    assert.match(buildPlayerHlsFallbackSrc('55', { session: '11111111-1111-1111-1111-111111111111', offset: '8000' }), /\/hls\/55\/master\.m3u8/);
    assert.match(withPlaybackAccessToken('/api/media-player/hls/1/master.m3u8?x=1', 'tok'), /access_token=tok/);
});

test('actor filters prefer the Plex role id then the name', () => {
    assert.deepEqual(actorQueryValues('1', 'Al Pacino'), ['1', 'Al Pacino']);
    assert.deepEqual(actorQueryValues('Al Pacino', 'Al Pacino'), ['Al Pacino']);
    assert.deepEqual(studioQueryValues('44', 'Warner Bros.'), ['44', 'Warner Bros.']);
    assert.deepEqual(studioQueryValues('Warner Bros.', 'Warner Bros.'), ['Warner Bros.']);
    assert.equal(studioNamesMatch('Apple TV+', 'Apple TV Plus'), true);
    assert.equal(studioNamesMatch('Starz', 'STARZ'), true);
    assert.deepEqual(
        expandStudioQueryValues('2552', 'Apple TV+', [
            { key: '88', title: 'Apple TV+' },
            { key: '9', title: 'Netflix' },
        ]),
        ['Apple TV+', '2552', '88'],
    );
    assert.deepEqual(
        expandStudioQueryValues('318', 'Starz', [{ key: '318', title: 'Starz' }]),
        ['Starz', '318'],
    );
    const person = pickPersonFromMetadata([
        {
            Role: [
                { id: 1, tag: 'Al Pacino', thumb: '/library/metadata/1/thumb' },
                { id: 2, tag: 'Robert De Niro' },
            ],
        },
    ], { actorId: '1', name: 'Al Pacino' });
    assert.equal(person.id, '1');
    assert.equal(person.name, 'Al Pacino');
    assert.equal(person.thumb, '/library/metadata/1/thumb');
});

test('mapPlayerItem extracts TMDB ids from Plex GUIDs', () => {
    const movie = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Guid: [{ id: 'imdb://tt0113277' }, { id: 'tmdb://949' }],
    });
    assert.equal(movie.tmdbId, 949);
    const show = mapPlayerItem({
        ratingKey: '9',
        title: 'The Wire',
        type: 'show',
        guid: 'com.plexapp.agents.themoviedb://1438?lang=en',
    });
    assert.equal(show.tmdbId, 1438);
    const episode = mapPlayerItem({
        ratingKey: '44',
        title: 'The Target',
        type: 'episode',
        grandparentTitle: 'The Wire',
        grandparentGuid: 'tmdb://1438',
        Guid: [{ id: 'tmdb://62085' }],
    });
    assert.equal(episode.tmdbId, 1438);
    assert.equal(episode.showTmdbId, 1438);
    const season = mapPlayerItem({
        ratingKey: '8',
        title: 'Season 1',
        type: 'season',
        grandparentGuid: 'tmdb://1438',
        Guid: [{ id: 'tmdb://3572' }],
    });
    assert.equal(season.tmdbId, 1438);
    assert.equal(season.showTmdbId, 1438);
    assert.equal(pickPlayerTmdbId({ type: 'movie', Guid: [{ id: 'tvdb://1' }] }), null);
    assert.equal(pickPlayerTmdbId({ type: 'movie', Guid: { id: 'tmdb://27205' } }), 27205);
    assert.equal(pickPlayerShowTmdbId({
        type: 'episode',
        grandparentGuid: 'plex://show/abc',
        Guid: [{ id: 'tmdb://999001' }],
    }), null);
});

test('applyShowMetaToPlayerChild prefers show TMDB id and studio over episode ids', () => {
    const episode = mapPlayerItemDetails({
        ratingKey: '44',
        title: 'Pilot',
        type: 'episode',
        grandparentTitle: 'Ted Lasso',
        grandparentGuid: 'plex://show/abc',
        Guid: [{ id: 'tmdb://999001' }],
        studio: '',
    });
    assert.equal(episode.tmdbId, 999001);
    const show = mapPlayerItemDetails({
        ratingKey: '9',
        title: 'Ted Lasso',
        type: 'show',
        guid: 'com.plexapp.agents.themoviedb://97546?lang=en',
        Studio: [{ id: 2552, filter: 'network=2552', tag: 'Apple TV+' }],
    });
    applyShowMetaToPlayerChild(episode, show);
    assert.equal(episode.tmdbId, 97546);
    assert.equal(episode.showTmdbId, 97546);
    assert.equal(episode.externalIds?.tmdb, 97546);
    assert.equal(episode.studio, 'Apple TV+');
    assert.equal(episode.showTitle, 'Ted Lasso');
});

test('applyShowMetaToPlayerChild fills missing season poster from the show', () => {
    const season = mapPlayerItemDetails({
        ratingKey: '31',
        title: 'Season 1',
        type: 'season',
        year: 2026,
    });
    assert.equal(season.thumb, null);
    const show = mapPlayerItemDetails({
        ratingKey: '9',
        title: 'Ted Lasso',
        type: 'show',
        thumb: '/library/metadata/9/thumb',
        art: '/library/metadata/9/art',
        summary: 'A coach arrives in London.',
    });
    applyShowMetaToPlayerChild(season, show);
    assert.equal(season.thumb, '/library/metadata/9/thumb');
    assert.equal(season.art, '/library/metadata/9/art');
    assert.equal(season.summary, 'A coach arrives in London.');
});

test('mapPlayerPersonSearchHit maps actor Directory rows for search', () => {
    assert.equal(isPlexPeopleSearchHub({ title: 'People', hubIdentifier: 'actor' }), true);
    assert.equal(isPlexPeopleSearchHub({ title: 'Movies' }), false);
    assert.equal(isPlexPersonSearchHit({ type: 'actor', id: '55', tag: 'Damian Lewis' }), true);
    assert.equal(isPlexPersonSearchHit({ type: 'movie', ratingKey: '1' }), false);
    const person = mapPlayerPersonSearchHit({
        id: '55',
        tag: 'Damian Lewis',
        type: 'actor',
        thumb: '/library/metadata/55/thumb',
    }, { serverIdentifier: 'abc' });
    assert.equal(person.type, 'person');
    assert.equal(person.title, 'Damian Lewis');
    assert.equal(person.personId, '55');
    assert.equal(person.canPlay, false);
    assert.equal(person.thumb, '/library/metadata/55/thumb');
    assert.equal(person.serverId, 'abc');
});

test('pickPersonThumb normalizes PMS URLs and keeps public plex.tv photos', () => {
    assert.equal(
        pickPersonThumb({ thumb: 'http://192.168.1.10:32400/library/metadata/55/thumb?X-Plex-Token=secret' }),
        '/library/metadata/55/thumb',
    );
    assert.equal(
        pickPersonThumb({ thumb: 'https://metadata-static.plex.tv/a/person.jpg?X-Plex-Token=secret' }),
        'https://metadata-static.plex.tv/a/person.jpg',
    );
    assert.equal(pickPersonThumb({ thumb: 'https://evil.example/photo.jpg' }), null);
    assert.equal(pickPersonThumb({ thumb: '' }), null);
    const cast = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Role: [{
            id: 9,
            tag: 'India Ria Amarteifio',
            role: 'Bethany',
            thumb: 'http://127.0.0.1:32400/library/metadata/99/thumb?X-Plex-Token=tok',
        }],
    }).cast;
    assert.equal(cast[0].thumb, '/library/metadata/99/thumb');
});

test('pickPlayerThumb normalizes absolute PMS URLs and synthesizes missing thumbs', () => {
    assert.equal(
        pickPlayerThumb({ ratingKey: '12', thumb: 'http://192.168.1.10:32400/library/metadata/12/thumb?X-Plex-Token=secret' }),
        '/library/metadata/12/thumb',
    );
    assert.equal(pickPlayerThumb({ ratingKey: '99' }), '/library/metadata/99/thumb');
    assert.equal(
        pickPlayerThumb({ ratingKey: '1', thumb: '/library/metadata/1/thumb?t=1' }),
        '/library/metadata/1/thumb',
    );
    assert.equal(mapPlayerItem({ ratingKey: '7', title: 'Heat', type: 'movie' }).thumb, '/library/metadata/7/thumb');
    assert.equal(pickPlayerThumb({ ratingKey: '3', type: 'season' }), null);
    assert.equal(
        pickPlayerThumb({ ratingKey: '3', type: 'season', parentThumb: '/library/metadata/9/thumb' }),
        '/library/metadata/9/thumb',
    );
    assert.equal(
        pickPlayerThumb({
            ratingKey: '5d776b59ad5437001f79c6f8',
            thumb: 'https://metadata-static.plex.tv/posters/apollo.jpg',
        }),
        'https://metadata-static.plex.tv/posters/apollo.jpg',
    );
    assert.equal(
        pickPlayerThumb({
            ratingKey: '5d776b59ad5437001f79c6f8',
            Image: [{ type: 'coverPoster', url: 'https://image.tmdb.org/t/p/w500/abc.jpg' }],
        }),
        'https://image.tmdb.org/t/p/w500/abc.jpg',
    );
    assert.equal(pickPlayerThumb({ ratingKey: '5d776b59ad5437001f79c6f8', type: 'movie' }), null);
});

test('mapContinueWatchingItem uses show poster and show title for episodes', () => {
    const episode = mapContinueWatchingItem({
        ratingKey: '44',
        title: 'Episode 11',
        type: 'episode',
        thumb: '/library/metadata/44/thumb',
        parentThumb: '/library/metadata/8/thumb',
        grandparentThumb: '/library/metadata/9/thumb',
        grandparentTitle: 'The Wire',
        parentTitle: 'Season 1',
    });
    assert.equal(episode.ratingKey, '44');
    assert.equal(episode.canPlay, true);
    assert.equal(episode.title, 'The Wire');
    assert.equal(episode.thumb, '/library/metadata/9/thumb');
    assert.equal(episode.episodeTitle, 'Episode 11');
    assert.equal(episode.episodeThumb, '/library/metadata/44/thumb');
    assert.equal(episode.cardAspect, '2/3');
    const seasonOnly = mapContinueWatchingItem({
        ratingKey: '45',
        title: 'Episode 8',
        type: 'episode',
        thumb: '/library/metadata/45/thumb',
        parentThumb: '/library/metadata/8/thumb',
        grandparentTitle: 'The Wire',
    });
    assert.equal(seasonOnly.thumb, '/library/metadata/8/thumb');
    const seasonPreferred = mapContinueWatchingItem({
        ratingKey: '46',
        title: 'Episode 2',
        type: 'episode',
        thumb: '/library/metadata/46/thumb',
        parentThumb: '/library/metadata/8/thumb',
        grandparentThumb: '/library/metadata/9/thumb',
        grandparentTitle: 'The Wire',
    }, { mediaPlayerContinueWatchingSeasonPoster: true });
    assert.equal(seasonPreferred.thumb, '/library/metadata/8/thumb');
    assert.equal(seasonPreferred.title, 'The Wire');
    const movie = mapContinueWatchingItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        thumb: '/library/metadata/12/thumb',
    });
    assert.equal(movie.title, 'Heat');
    assert.equal(movie.thumb, '/library/metadata/12/thumb');
});

test('isAllowedPlexProxyUrl only allows the configured PMS origin', () => {
    const origin = 'http://192.168.1.10:32400';
    assert.equal(isAllowedPlexProxyUrl('http://192.168.1.10:32400/video/:/transcode/universal/session/1/index.m3u8', origin), true);
    assert.equal(isAllowedPlexProxyUrl('http://evil.example/steal', origin), false);
    assert.equal(isAllowedPlexProxyUrl('file:///etc/passwd', origin), false);
});

test('rewritePlaylistUrls points segments at the portal proxy and keeps PMS host', () => {
    const body = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="session/1/init.mp4"',
        'http://127.0.0.1:32400/video/:/transcode/universal/session/1/seg0.ts?X-Plex-Token=secret',
    ].join('\n');
    const out = rewritePlaylistUrls(body, 'http://192.168.1.10:32400', '/api/media-player/proxy?u=');
    assert.match(out, /URI="\/api\/media-player\/proxy\?u=/);
    assert.match(out, /192\.168\.1\.10(%3A|:)32400/);
    assert.equal(out.includes('secret'), false);
    assert.equal(rewritePlexUrlToOrigin('http://127.0.0.1:32400/foo', 'http://192.168.1.10:32400'), 'http://192.168.1.10:32400/foo');
});

test('rewritePlaylistUrls can stamp access_token for ExoPlayer segment requests', () => {
    const body = [
        '#EXTM3U',
        'http://192.168.1.10:32400/video/:/transcode/universal/session/1/seg0.ts',
    ].join('\n');
    const out = rewritePlaylistUrls(
        body,
        'http://192.168.1.10:32400',
        '/api/media-player/proxy?u=',
        'http://192.168.1.10:32400/start.m3u8',
        'tok-123',
    );
    assert.match(out, /access_token=tok-123/);
});

test('rewritePlaylistUrls resolves relative session paths from the playlist URL', () => {
    const body = [
        '#EXTM3U',
        '#EXT-X-MAP:URI="session/1/init.mp4"',
        'session/1/index.m3u8',
    ].join('\n');
    const playlistUrl = 'http://192.168.1.10:32400/video/:/transcode/universal/start.m3u8';
    const out = rewritePlaylistUrls(body, 'http://192.168.1.10:32400', '/api/media-player/proxy?u=', playlistUrl);
    assert.match(out, /transcode%2Funiversal%2Fsession%2F1%2Findex\.m3u8/);
    assert.match(out, /transcode%2Funiversal%2Fsession%2F1%2Finit\.mp4/);
});

test('clampPlayOffsetMs skips tiny and near-end resumes', () => {
    assert.equal(clampPlayOffsetMs(1200, 1_500_000), 0);
    assert.equal(clampPlayOffsetMs(1_490_000, 1_500_000), 0);
    assert.equal(clampPlayOffsetMs(80_000, 1_500_000), 80_000);
});

test('buildPlexTimelineParams reports playhead to Plex', () => {
    const params = buildPlexTimelineParams({
        ratingKey: '44',
        state: 'playing',
        timeMs: 12500,
        durationMs: 1500000,
        sessionId: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(params.get('ratingKey'), '44');
    assert.equal(params.get('key'), '/library/metadata/44');
    assert.equal(params.get('state'), 'playing');
    assert.equal(params.get('time'), '12500');
    assert.equal(params.get('duration'), '1500000');
    assert.equal(params.get('X-Plex-Session-Identifier'), '11111111-1111-4111-8111-111111111111');
    assert.equal(params.get('subtitleStreamID'), '0');
    const withStreams = buildPlexTimelineParams({
        ratingKey: '44',
        state: 'playing',
        audioStreamId: '20',
        subtitleStreamId: '31',
    });
    assert.equal(withStreams.get('audioStreamID'), '20');
    assert.equal(withStreams.get('subtitleStreamID'), '31');
    assert.equal(isPlaySessionId('not-a-session'), false);
});

test('mapPlayerRatings maps IMDb RT popcorn and TMDB scores', () => {
    const ratings = mapPlayerRatings({
        type: 'movie',
        Guid: [{ id: 'imdb://tt0113277' }, { id: 'tmdb://949' }],
        Rating: [
            { image: 'imdb://image.rating', value: 6.3 },
            { image: 'rottentomatoes://image.rating.ripe', value: 6.5, type: 'critic' },
            { image: 'rottentomatoes://image.rating.upright', value: 6.3, type: 'audience' },
            { image: 'themoviedb://image.rating', value: 6.3 },
        ],
    });
    assert.equal(ratings.imdb.percent, 63);
    assert.equal(ratings.imdb.url, 'https://www.imdb.com/title/tt0113277/');
    assert.equal(ratings.rottenTomatoes.percent, 65);
    assert.equal(ratings.rottenTomatoes.fresh, true);
    assert.equal(ratings.popcorn.percent, 63);
    assert.equal(ratings.popcorn.fresh, true);
    assert.equal(ratings.tmdb.percent, 63);
    assert.match(ratings.tmdb.url, /themoviedb\.org\/movie\/949/);
});

test('pickPlayerLogo uses Plex clearLogo art and ignores other image types', () => {
    assert.equal(pickPlayerLogo({
        Image: [
            { type: 'coverPoster', url: '/library/metadata/12/thumb' },
            { type: 'clearLogo', url: '/library/metadata/12/clearLogo/1694' },
            { type: 'background', url: '/library/metadata/12/art' },
        ],
    }), '/library/metadata/12/clearLogo/1694');
    assert.equal(pickPlayerLogo({ Image: { type: 'logo', url: '/library/metadata/9/clearLogo' } }), '/library/metadata/9/clearLogo');
    assert.equal(pickPlayerLogo({ Image: [{ type: 'coverPoster', url: '/library/metadata/12/thumb' }] }), null);
    assert.equal(pickPlayerLogo({
        Image: [{ type: 'clearLogo', url: 'https://evil.example/logo.png' }],
        ratingKey: '12',
        type: 'movie',
    }), null);
    assert.equal(pickPlayerLogo({
        Image: [{ type: 'clearLogo', url: 'https://metadata-static.plex.tv/a/logo.png' }],
    }), 'https://metadata-static.plex.tv/a/logo.png');
    assert.equal(pickPlayerLogo({ ratingKey: '12', type: 'movie' }), '/library/metadata/12/clearLogo');
    assert.equal(pickPlayerLogo({
        ratingKey: '44',
        type: 'episode',
        grandparentRatingKey: '9',
    }), '/library/metadata/9/clearLogo');
    const movie = mapPlayerItem({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        Image: [{ type: 'clearLogo', url: '/library/metadata/12/clearLogo' }],
    });
    assert.equal(movie.logo, '/library/metadata/12/clearLogo');
});

test('theme paths stay on the library metadata route and never include a Plex token', () => {
    assert.equal(isPlayerThemePath('/library/metadata/99/theme'), true);
    assert.equal(isPlayerThemePath('/library/metadata/99/theme?t=123'), true);
    assert.equal(isPlayerThemePath('/library/parts/1/file'), false);
    assert.equal(isPlayerThemePath('https://evil.example/theme.mp3'), false);
    assert.equal(pickPlayerThemePath({
        theme: '/library/metadata/99/theme?t=123&X-Plex-Token=secret',
    }), '/library/metadata/99/theme?t=123');
    assert.equal(pickPlayerThemeKey({
        ratingKey: '100',
        type: 'episode',
        grandparentTheme: '/library/metadata/99/theme?t=1',
    }), '99');
    assert.equal(pickPlayerThemeKey({ ratingKey: '12', type: 'movie' }), '');
    const show = mapPlayerItem({
        ratingKey: '99',
        title: 'The Wire',
        type: 'show',
        theme: '/library/metadata/99/theme?t=123&X-Plex-Token=secret',
    });
    assert.equal(show.themeKey, '99');
    assert.equal(JSON.stringify(show).includes('secret'), false);
    assert.equal(JSON.stringify(show).includes('/theme'), false);
    assert.equal(buildPlayerThemeSrc('99'), '/api/media-player/theme/99');
    assert.equal(buildPlayerThemeSrc('../etc/passwd'), '');
});

test('player profile avatars stay on public or proxied URLs', () => {
    assert.equal(safePlayerAvatarUrl('https://plex.tv/users/abc/avatar?X-Plex-Token=secret').includes('secret'), false);
    assert.match(safePlayerAvatarUrl('https://plex.tv/users/abc/avatar?X-Plex-Token=secret'), /^https:\/\/plex\.tv\//);
    assert.equal(safePlayerAvatarUrl('https://evil.example/avatar.png'), '');
    assert.equal(safePlayerAvatarUrl('javascript:alert(1)'), '');
    assert.match(safePlayerAvatarUrl('/library/metadata/9/thumb'), /^\/api\/plex\/image\?path=/);
    const profile = mapPlayerProfile({
        username: 'Jason',
        thumb: 'https://plex.tv/users/abc/avatar?X-Plex-Token=secret',
    });
    assert.equal(profile.username, 'Jason');
    assert.equal(String(profile.thumb).includes('secret'), false);
});

test('mapPlayerItemDetails keeps filenames and never leaks filesystem paths', () => {
    const details = mapPlayerItemDetails({
        ratingKey: '12',
        title: 'Motor City',
        type: 'movie',
        Media: [{
            bitrate: 15693,
            videoResolution: '4k',
            videoCodec: 'hevc',
            videoProfile: 'main',
            width: 3840,
            height: 2160,
            container: 'mkv',
            Part: [{
                file: '/var/lib/plexmediaserver/Library/secret/4kmovies/Motor City (2026)/Motor City (2026).mkv',
                size: 12161810432,
                container: 'mkv',
                duration: 6218000,
                Stream: [
                    { streamType: 1, codec: 'hevc', profile: 'main', bitrate: 14993, width: 3840, height: 2160, bitDepth: 8 },
                    { streamType: 2, codec: 'eac3', channels: 6, language: 'English', displayTitle: 'English (EAC3 5.1)' },
                ],
            }],
        }],
    });
    assert.equal(details.canPlay, true);
    assert.equal(details.mediaInfo[0].parts[0].fileName, 'Motor City (2026).mkv');
    const json = JSON.stringify(details);
    assert.equal(json.includes('/var/lib'), false);
    assert.equal(json.includes('plexmediaserver'), false);
    assert.equal(json.includes('/secrets/'), false);
    assert.equal(json.includes('4kmovies'), false);
    const windows = mapPlayerMediaInfo({
        Media: [{ Part: [{ file: 'C:\\\\Plex\\\\Library\\\\secret\\\\Heat.mkv' }] }],
    });
    assert.equal(windows[0].parts[0].fileName, 'Heat.mkv');
    assert.equal(JSON.stringify(windows).includes('Library'), false);
});

test('mapPlayerMediaInfo includes stream ids for audio and subtitle pickers', () => {
    const info = mapPlayerMediaInfo({
        Media: [{
            Part: [{
                file: '/library/Heat.mkv',
                Stream: [
                    { id: 1, streamType: 1, codec: 'hevc', profile: 'main 10', level: 120, frameRate: '23.976', displayTitle: '4K' },
                    { id: 101, streamType: 2, codec: 'eac3', channels: 6, audioChannelLayout: '5.1(side)', samplingRate: 48000, bitrate: 640, language: 'English', displayTitle: 'English (EAC3 5.1)', selected: true },
                    { id: 102, streamType: 2, codec: 'aac', channels: 2, language: 'English', displayTitle: 'English (AAC)' },
                    { id: 201, streamType: 3, codec: 'srt', language: 'English', displayTitle: 'English SDH (SRT)', selected: true },
                    { id: 202, streamType: 3, codec: 'srt', language: 'Spanish', displayTitle: 'Spanish (SRT)' },
                ],
            }],
        }],
    });
    assert.equal(info[0].parts[0].video.level, '120');
    assert.equal(info[0].parts[0].video.frameRate, '23.976');
    assert.equal(info[0].parts[0].audio[0].id, '101');
    assert.equal(info[0].parts[0].audio[0].selected, true);
    assert.equal(info[0].parts[0].audio[0].channelLayout, '5.1(side)');
    assert.equal(info[0].parts[0].audio[0].samplingRate, 48000);
    assert.equal(info[0].parts[0].subtitles[0].id, '201');
    assert.equal(info[0].parts[0].subtitles[1].id, '202');
});

test('collection children come from hubs, directories, and nested includeChildren', () => {
    const fromHub = collectionChildItems({
        MediaContainer: {
            Hub: [{ Metadata: [{ ratingKey: '101', title: 'Heat', type: 'movie' }] }],
        },
    }, '831577');
    assert.equal(fromHub.length, 1);
    assert.equal(fromHub[0].title, 'Heat');

    const fromDirectory = collectionChildItems({
        MediaContainer: {
            Directory: [{ ratingKey: '9', title: 'The Wire', type: 'show' }],
        },
    }, '80');
    assert.equal(fromDirectory[0].ratingKey, '9');

    const nested = collectionChildItems({
        MediaContainer: {
            Metadata: {
                ratingKey: '831577',
                title: "Valentine's Day Movies",
                type: 'collection',
                Children: {
                    Metadata: [
                        { ratingKey: '12', title: 'Heat', type: 'movie' },
                        { ratingKey: '831577', title: "Valentine's Day Movies", type: 'collection' },
                    ],
                },
            },
        },
    }, '831577');
    assert.equal(nested.length, 1);
    assert.equal(nested[0].ratingKey, '12');
});

test('collection child paths prefer the collection key and smart-filter content', () => {
    assert.equal(
        safePlexLibraryPath('server://abc/com.plexapp.plugins.library/library/sections/6/all?type=1'),
        '/library/sections/6/all?type=1',
    );
    const paths = collectionChildPaths({
        ratingKey: '831577',
        key: '/library/metadata/831577',
        content: 'server://abc/com.plexapp.plugins.library/library/sections/6/all?type=1',
        librarySectionID: 6,
        index: 12,
    }, '831577');
    assert.deepEqual(paths, [
        '/library/metadata/831577/children',
        '/library/collections/831577/children',
        '/library/sections/6/all?type=1',
        '/library/sections/6/all?collection=831577',
        '/library/sections/6/all?collection=12',
    ]);
    const qs = withPlexContainerParams('/library/sections/6/all?type=1', 'tok', { start: 0, size: 500 });
    assert.equal(qs.includes('type=1'), true);
    assert.equal(qs.includes('X-Plex-Container-Size=500'), true);
    assert.equal(qs.includes('X-Plex-Token=tok'), true);
});

test('clips and extras are playable and related hubs keep titles', () => {
    const clip = mapPlayerItem({ ratingKey: '99', title: 'Trailer', type: 'clip', extraType: 1, subtype: 'trailer' });
    assert.equal(clip.canPlay, true);
    assert.equal(clip.extraType, '1');
    assert.equal(clip.extraSubtype, 'trailer');
    const trailerType = mapPlayerItem({ ratingKey: '100', title: 'Scary Movie', type: 'trailer', extraType: 1 });
    assert.equal(trailerType.type, 'clip');
    assert.equal(trailerType.canPlay, true);
    const trailerId = mapPlayerItem({ ratingKey: '101', title: 'Teaser', type: 5 });
    assert.equal(trailerId.type, 'clip');
    assert.equal(trailerId.canPlay, true);
    const extras = mapPlayerExtras([
        { ratingKey: '99', title: 'Motor City Trailer', extraType: 1, subtype: 'trailer' },
        { ratingKey: '100', title: 'Scary Movie', type: 'trailer' },
        { ratingKey: '102', title: 'Wayans Family', type: 'clip', subtype: 'behindTheScenes' },
    ]);
    assert.equal(extras[0].type, 'clip');
    assert.equal(extras[0].canPlay, true);
    assert.equal(extras[1].type, 'clip');
    assert.equal(extras[1].canPlay, true);
    assert.equal(extras[1].extraSubtype, 'trailer');
    assert.equal(extras[2].canPlay, true);
    const nested = listPlayerExtraMetas({
        MediaContainer: {
            Metadata: [{
                ratingKey: '1',
                type: 'movie',
                Extras: {
                    Metadata: [{ ratingKey: '201', title: 'Trailer', type: 'clip', extraType: 1, subtype: 'trailer' }],
                },
            }],
        },
    });
    assert.equal(nested.length, 1);
    assert.equal(nested[0].ratingKey, '201');
    const videos = listPlayerExtraMetas({
        MediaContainer: {
            Video: [{ ratingKey: '202', title: 'Featurette', type: 'clip', subtype: 'behindTheScenes' }],
        },
    });
    assert.equal(videos[0].ratingKey, '202');
    const hubs = mapPlayerHubs([{
        title: 'More with Alan Ritchson',
        hubIdentifier: 'actor.more',
        Metadata: [{ ratingKey: '80', title: 'Reacher', type: 'show' }],
    }]);
    assert.equal(hubs[0].title, 'More with Alan Ritchson');
    assert.equal(hubs[0].items[0].title, 'Reacher');
});

test('home hubs follow Plex pin order and keep collection keys', () => {
    assert.equal(collectionRatingKeyFromHub({
        hubIdentifier: 'movie.collection.831577',
        key: '/library/collections/831577/children',
    }), '831577');
    assert.equal(collectionRatingKeyFromHub({ hubIdentifier: 'movie.recentlyadded' }), '');
    assert.equal(playlistRatingKeyFromHub({
        type: 'playlist',
        key: '/playlists/55/items',
    }), '55');
    const homeHubs = mapPlayerHomeHubs([
        {
            title: 'Trending Movies',
            hubIdentifier: 'movie.collection.831577',
            key: '/library/collections/831577/children',
            Metadata: [{ ratingKey: '12', title: 'Heat', type: 'movie' }],
        },
        {
            title: 'Continue Watching',
            hubIdentifier: 'home.continueWatching',
            Metadata: [{
                ratingKey: '44',
                type: 'episode',
                title: 'Pilot',
                grandparentTitle: 'The Wire',
                grandparentThumb: '/library/metadata/9/thumb',
            }],
        },
        {
            title: 'Empty',
            hubIdentifier: 'movie.empty',
            Metadata: [],
        },
    ]);
    assert.equal(homeHubs.length, 2);
    assert.equal(homeHubs[0].title, 'Trending Movies');
    assert.equal(homeHubs[0].collectionRatingKey, '831577');
    assert.equal(homeHubs[0].hubKey, '/library/collections/831577/children');
    assert.equal(homeHubs[1].identifier, 'home.continueWatching');
    assert.equal(homeHubs[1].items[0].title, 'The Wire');
});

test('hero cover art comes from the Plex movie or show guid', () => {
    assert.equal(plexHeroUuidFromMeta({
        type: 'movie',
        guid: 'plex://movie/5d776b59ad5437001f79c6f8',
    }), '5d776b59ad5437001f79c6f8');
    assert.equal(plexHeroUuidFromMeta({
        type: 'episode',
        guid: 'plex://episode/abc',
        grandparentGuid: 'plex://show/showhero1',
    }), 'showhero1');
    assert.equal(coverArtUrlFromProvider({
        MediaContainer: {
            Metadata: [{
                Image: [
                    { type: 'background', url: 'https://metadata-static.plex.tv/bg.jpg' },
                    { type: 'coverArt', url: 'https://metadata-static.plex.tv/hero.jpg' },
                ],
            }],
        },
    }), 'https://metadata-static.plex.tv/hero.jpg');
    assert.equal(coverArtUrlFromProvider({ MediaContainer: { Metadata: [{ Image: [{ type: 'background', url: 'https://x' }] }] } }), '');
    assert.deepEqual(heroAssetsFromProvider({
        MediaContainer: {
            Metadata: [{
                Image: [
                    { type: 'coverArt', url: 'https://metadata-static.plex.tv/hero-small.jpg', width: 960 },
                    { type: 'coverArt', url: 'https://metadata-static.plex.tv/hero.jpg', width: 1920 },
                    { type: 'background', url: 'https://metadata-static.plex.tv/bg-4k.jpg', width: 3840 },
                    { type: 'clearLogo', url: 'https://metadata-static.plex.tv/logo.png' },
                ],
            }],
        },
    }), {
        still: 'https://metadata-static.plex.tv/hero.jpg',
        logo: '',
    });
});

test('same-titled pinned home rows merge into one row', () => {
    const hubs = mergeSameTitleHomeHubs([
        {
            title: 'Halloween',
            identifier: 'movie.collection.1',
            items: [{ ratingKey: 'a', title: 'Halloween' }, { ratingKey: 'b', title: 'Scream' }],
        },
        {
            title: 'Continue Watching',
            identifier: 'home.continue',
            items: [{ ratingKey: 'c', title: 'Pilot' }],
        },
        {
            title: 'halloween',
            identifier: 'show.collection.2',
            heroRow: true,
            items: [{ ratingKey: 'b', title: 'Scream' }, { ratingKey: 'd', title: 'The Thing' }],
        },
    ]);
    assert.equal(hubs.length, 2);
    assert.equal(hubs[0].title, 'Halloween');
    assert.equal(hubs[0].heroRow, true);
    assert.deepEqual(hubs[0].items.map((item) => item.ratingKey), ['a', 'b', 'd']);
    assert.equal(hubs[1].title, 'Continue Watching');
});

test('merged random collections are shuffled together', () => {
    assert.equal(isRandomOrderSource({ content: '/library/sections/1/all?type=1&sort=random&limit=40' }), true);
    assert.equal(isRandomOrderSource({ key: '/library/collections/9/children?sort=titleSort' }), false);
    const rows = [
        { title: 'Halloween', randomOrder: true, items: [{ ratingKey: 'a' }, { ratingKey: 'b' }] },
        { title: 'Halloween', randomOrder: true, items: [{ ratingKey: 'c' }, { ratingKey: 'd' }, { ratingKey: 'e' }, { ratingKey: 'f' }] },
    ];
    const orders = new Set();
    for (let pass = 0; pass < 12; pass += 1) {
        const hubs = mergeSameTitleHomeHubs(rows);
        const keys = hubs[0].items.map((item) => item.ratingKey);
        assert.deepEqual([...keys].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
        orders.add(keys.join(','));
    }
    assert.ok(orders.size > 1);
});

test('only Heros or Heroes collection labels mark a home row', async () => {
    assert.equal(isHeroRowLabel('Heros'), true);
    assert.equal(isHeroRowLabel('heroes'), true);
    assert.equal(isHeroRowLabel(' Hero '), false);
    assert.equal(collectionMetaHasHeroLabel({ Label: [{ tag: 'Heros' }] }), true);
    assert.equal(collectionMetaHasHeroLabel({ Label: [{ tag: 'Holiday' }] }), false);
    const hubs = await markHeroCollectionHubs([
        { title: 'Trending', collectionRatingKey: '9', items: [{}] },
        { title: 'Most Watched', collectionRatingKey: '4', items: [{}] },
        { title: 'Continue Watching', items: [{}] },
    ], async (id) => (id === '9' ? { Label: [{ tag: 'Heroes' }] } : { Label: [{ tag: 'Weekly' }] }));
    assert.equal(hubs[0].heroRow, true);
    assert.equal(hubs[1].heroRow, undefined);
    assert.equal(hubs[2].heroRow, undefined);
});

test('library home still shows the rest of the library when Continue Watching is present', () => {
    const hubs = assembleLibraryHomeHubs({
        sectionHubs: [
            { title: 'Recently Added', hubIdentifier: 'movie.recentlyadded', Metadata: [] },
            { title: 'Top Drama', hubIdentifier: 'movie.genre.1', Metadata: { ratingKey: '9', title: 'Heat', type: 'movie' } },
        ],
        onDeckItems: [{ ratingKey: '1', title: 'Angel in the Rubble' }],
        recentItems: [
            { ratingKey: '2', title: 'Pinocchio' },
            { ratingKey: '3', title: 'The Wire' },
        ],
        newestItems: [
            { ratingKey: '4', title: 'Newest' },
        ],
    });
    assert.deepEqual(hubs.map((hub) => hub.identifier), [
        'continueWatching',
        'movie.genre.1',
        'recentlyAdded',
        'recentlyReleased',
    ]);
    assert.equal(hubs[0].items[0].title, 'Angel in the Rubble');
    assert.equal(hubs[1].items[0].title, 'Heat');
});

test('library home does not duplicate Recently Added when the hub already has items', () => {
    const hubs = assembleLibraryHomeHubs({
        sectionHubs: [{
            title: 'Recently Added',
            hubIdentifier: 'movie.recentlyadded',
            Metadata: [{ ratingKey: '2', title: 'Pinocchio', type: 'movie' }],
        }],
        onDeckItems: [{ ratingKey: '1', title: 'Angel in the Rubble' }],
        recentItems: [{ ratingKey: '8', title: 'Other' }],
        newestItems: [{ ratingKey: '2', title: 'Pinocchio' }],
    });
    assert.equal(hubs.filter((hub) => /recentlyadded/i.test(hub.identifier)).length, 1);
    assert.equal(hubs.find((hub) => hub.identifier === 'movie.recentlyadded').items[0].title, 'Pinocchio');
    assert.equal(hubs.some((hub) => hub.identifier === 'recentlyReleased'), false);
});

test('library home keeps a single Continue Watching hub', () => {
    assert.equal(isLibraryContinueWatchingHub({ hubIdentifier: 'movie.inProgress', title: 'In Progress' }), true);
    assert.equal(isLibraryContinueWatchingHub({ title: 'Continue Watching', hubIdentifier: 'movie.recentlyViewed' }), true);
    assert.equal(isLibraryContinueWatchingHub({ title: 'Recently Added', hubIdentifier: 'movie.recentlyadded' }), false);
    const hubs = dedupeLibraryContinueWatchingHubs([
        { title: 'Continue Watching', identifier: 'continueWatching', items: [{ ratingKey: '1' }] },
        { title: 'Continue Watching', identifier: 'movie.inProgress', items: [{ ratingKey: '2' }] },
        { title: 'Recently Added', identifier: 'movie.recentlyadded', items: [{ ratingKey: '3' }] },
    ]);
    assert.equal(hubs.length, 2);
    assert.equal(hubs[0].identifier, 'continueWatching');
    assert.equal(hubs[1].identifier, 'movie.recentlyadded');
});

test('member Continue Watching replaces admin On Deck and is omitted when empty', () => {
    const adminHubs = [
        { title: 'Continue Watching', identifier: 'home.continueWatching', items: [{ ratingKey: 'admin-1', title: 'Admin Movie' }] },
        { title: 'Trending Movies', identifier: 'movie.trending', items: [{ ratingKey: '12', title: 'Heat' }] },
    ];
    const replaced = withMemberContinueWatching(adminHubs, [{ ratingKey: 'vik-1', title: 'Vik Show' }]);
    assert.equal(replaced[0].items[0].title, 'Vik Show');
    assert.equal(replaced[1].title, 'Trending Movies');
    const stripped = withMemberContinueWatching(adminHubs, []);
    assert.equal(stripped.length, 1);
    assert.equal(stripped[0].title, 'Trending Movies');
    const kept = withMemberContinueWatching(adminHubs, [], { keepWhenEmpty: true });
    assert.equal(kept[0].items[0].title, 'Admin Movie');
});

test('markers, versions, watched, and play offset resolution', () => {
    const details = mapPlayerItemDetails({
        ratingKey: '12',
        title: 'Heat',
        type: 'movie',
        viewCount: 1,
        viewOffset: 120000,
        duration: 600000,
        Marker: [
            { type: 'intro', startTimeOffset: 8000, endTimeOffset: 72000 },
            { type: 'credits', startTimeOffset: 540000, endTimeOffset: 590000 },
        ],
        Media: [
            { id: 1, videoResolution: '4k', videoCodec: 'hevc', container: 'mkv', height: 2160, Part: [{ id: 9 }] },
            { id: 2, videoResolution: '1080', videoCodec: 'h264', container: 'mp4', height: 1080, Part: [{ id: 10 }] },
        ],
    });
    assert.equal(details.watched, true);
    assert.equal(details.viewOffsetMs, 120000);
    assert.equal(plexViewOffsetMs({
        UserState: { viewOffset: 600000, viewCount: 1 },
    }), 600000);
    const partial = mapPlayerItem({
        ratingKey: '99',
        type: 'episode',
        title: 'Pilot',
        duration: 2400000,
        UserState: [{ viewOffset: 600000 }],
    });
    assert.equal(partial.viewOffsetMs, 600000);
    assert.equal(details.markers.intro.startMs, 8000);
    assert.equal(details.markers.credits.endMs, 590000);
    assert.equal(details.versions.length, 2);
    assert.equal(details.versions[0].label.includes('4K'), true);
    assert.equal(details.versions[1].mediaIndex, 1);

    const show = mapPlayerItem({ type: 'show', leafCount: 13, viewedLeafCount: 13, viewCount: 0, ratingKey: '9', title: 'The Wire' });
    assert.equal(show.watched, true);
    const unwatchedShow = mapPlayerItem({ type: 'show', leafCount: 13, viewedLeafCount: 2, ratingKey: '9', title: 'The Wire' });
    assert.equal(unwatchedShow.watched, false);
    const rewatched = mapPlayerItem({ type: 'show', leafCount: 40, viewedLeafCount: 48, ratingKey: '1', title: 'Farm' });
    assert.equal(rewatched.viewedLeafCount, 40);
    const withUnviewed = mapPlayerItem({ type: 'show', leafCount: 40, viewedLeafCount: 48, unviewedLeafCount: 3, ratingKey: '1', title: 'Farm' });
    assert.equal(withUnviewed.viewedLeafCount, 37);

    assert.equal(resolvePlayOffsetMs(undefined, 120000, 600000), 120000);
    assert.equal(resolvePlayOffsetMs(0, 120000, 600000), 0);
    assert.equal(resolvePlayOffsetMs(2000, 120000, 600000), 0);

    const selected = withSelectedMedia({ Media: [{ id: 1 }, { id: 2 }] }, 1);
    assert.equal(selected.Media[0].id, 2);
    assert.equal(pickMediaIndex(9, { Media: [{ id: 1 }, { id: 2 }] }), 1);
    assert.equal(mapPlayerPlaybackMode({ useDirectFile: true }), 'directPlay');
    assert.equal(mapPlayerPlaybackMode({ useDirectFile: false, copyOriginal: true, qualityId: 'original' }), 'directStream');
    assert.equal(mapPlayerPlaybackMode({ useDirectFile: false, copyOriginal: false, qualityId: 'original' }), 'transcode');

    const playlist = mapPlayerPlaylist({ ratingKey: '55', title: 'Night movies', playlistType: 'video', leafCount: 4, smart: 0 });
    assert.equal(playlist.type, 'playlist');
    assert.equal(playlist.canPlay, false);
    assert.equal(playlist.leafCount, 4);
    assert.equal(plexPlaylistUri('abc', '12'), 'server://abc/com.plexapp.plugins.library/library/metadata/12');
});

test('player settings pick audio language and subtitle mode', () => {
    const settings = normalizePlayerSettings({
        mixLibraries: 'yes',
        autoplayNext: false,
        defaultQualityId: '720-4',
        audioLanguage: 'EN',
        subtitleMode: 'always',
        autoSkipIntro: true,
        autoSkipCredits: 'true',
    });
    assert.equal(settings.mixLibraries, false);
    assert.equal(settings.autoplayNext, false);
    assert.equal(settings.defaultQualityId, '720-4');
    assert.equal(settings.audioLanguage, 'en');
    assert.equal(settings.subtitleMode, 'always');
    assert.equal(settings.autoSkipIntro, true);
    assert.equal(settings.autoSkipCredits, false);
    assert.equal(settings.showPlaylists, true);
    assert.equal(settings.playThemeTunes, true);
    assert.equal(normalizePlayerSettings({ playThemeTunes: false }).playThemeTunes, false);
    assert.equal(normalizePlayerSettings({}).playThemeTunes, true);
    assert.equal(normalizePlayerSettings({}).serviceLogoPlates, true);
    assert.equal(normalizePlayerSettings({ serviceLogoPlates: false }).serviceLogoPlates, false);
    assert.equal(normalizePlayerSettings({}).showEpisodeFilePills, true);
    assert.equal(normalizePlayerSettings({ showEpisodeFilePills: false }).showEpisodeFilePills, false);
    assert.equal(normalizePlayerSettings({}).watchedTickPosition, 'top-right');
    assert.equal(normalizePlayerSettings({}).phoneOverviewPoster, false);
    assert.equal(normalizePlayerSettings({ phoneOverviewPoster: true }).phoneOverviewPoster, true);
    assert.equal(normalizePlayerSettings({ watchedTickPosition: 'bottom-left' }).watchedTickPosition, 'bottom-left');
    assert.equal(normalizePlayerSettings({ watchedTickPosition: 'nope' }).watchedTickPosition, 'top-right');
    assert.deepEqual(settings.homeRowOrder, []);
    assert.deepEqual(settings.libraryNavOrder, []);
    assert.equal(normalizePlayerSettings({ audioLanguage: 'not-a-code' }).audioLanguage, '');
    assert.equal(normalizePlayerSettings({ showPlaylists: false }).showPlaylists, false);
    assert.equal(normalizePlayerSettings({}).continueWatchingLayout, 'poster');
    assert.equal(normalizePlayerSettings({ continueWatchingLayout: 'title' }).continueWatchingLayout, 'title');
    assert.equal(normalizePlayerSettings({ continueWatchingLayout: 'nope' }).continueWatchingLayout, 'poster');
    assert.deepEqual(
        normalizeHomeRowOrder(['playlists', 'libraries', 'libraries', 'recent:12', 'nope', 'recent:movie']),
        ['playlists', 'libraries', 'recent:12', 'recent:movie'],
    );
    assert.deepEqual(
        collapseHomeRowOrder(['recent:2', 'continueWatching', 'libraries', 'playlists', 'recent:1']),
        ['recents', 'continueWatching', 'playlists'],
    );
    assert.deepEqual(
        applyHomeRowOrder(defaultHomeRowIds(), ['recent:2', 'continueWatching', 'gone']),
        ['recents', 'continueWatching', 'playlists'],
    );
    assert.deepEqual(
        applyLibraryNavOrder([{ key: '1' }, { key: '2' }, { key: '3' }], ['3', '1']),
        [{ key: '3' }, { key: '1' }, { key: '2' }],
    );
    assert.equal(classifyPlayerHomeHub({ identifier: 'tv.recentlyadded', title: 'Recently Added TV' }), 'show');
    assert.equal(classifyPlayerHomeHub({ identifier: 'movie.top', title: 'Top Movies Of The Week' }), 'movie');
    assert.equal(classifyPlayerHomeHub({ identifier: 'home.continueWatching', title: 'Continue Watching' }), 'continueWatching');
    assert.deepEqual(
        applyLibraryNavOrderToHubs(
            [
                { identifier: 'movie.top', title: 'Top Movies Of The Week', items: [{ type: 'movie' }] },
                { identifier: 'home.continueWatching', title: 'Continue Watching', items: [{ type: 'episode' }] },
                { identifier: 'tv.recentlyadded', title: 'Recently Added TV', items: [{ type: 'show' }] },
                { identifier: 'movie.recentlyadded', title: 'Recently Added Movies', items: [{ type: 'movie' }] },
            ],
            [
                { key: '10', type: 'show' },
                { key: '2', type: 'movie' },
                { key: '3', type: 'movie' },
            ],
            ['10', '2', '3'],
        ).map((hub) => hub.identifier),
        ['home.continueWatching', 'tv.recentlyadded', 'movie.top', 'movie.recentlyadded'],
    );
    assert.deepEqual(
        applyLibraryNavOrderToHubs(
            [
                { identifier: 'movie.a', title: 'Movies Misc', items: [{ type: 'movie', librarySectionID: '2' }] },
                { identifier: 'movie.b', title: 'Movies Main', items: [{ type: 'movie', librarySectionID: '3' }] },
                { identifier: 'tv.a', title: 'TV', items: [{ type: 'show', librarySectionID: '10' }] },
            ],
            [
                { key: '10', type: 'show' },
                { key: '3', type: 'movie' },
                { key: '2', type: 'movie' },
            ],
            ['10', '3', '2'],
        ).map((hub) => hub.identifier),
        ['tv.a', 'movie.b', 'movie.a'],
    );
    assert.deepEqual(
        applyLibraryNavOrderToHubs(
            [
                { identifier: 'movie.top', title: 'Top Movies', items: [{ type: 'movie' }] },
                { identifier: 'tv.recentlyadded', title: 'Recently Added TV', items: [{ type: 'show' }] },
            ],
            [{ key: '10', type: 'show' }, { key: '2', type: 'movie' }],
            [],
        ).map((hub) => hub.identifier),
        ['tv.recentlyadded', 'movie.top'],
    );
    assert.deepEqual(
        normalizePlayerSettings({ homeRowOrder: ['recent:5', 'playlists', 'recent:2'] }).libraryNavOrder,
        ['5', '2'],
    );
    assert.deepEqual(
        normalizeLibraryNavOrder(['5', '5', 'no pe', 'ok_lib']),
        ['5', 'ok_lib'],
    );
    assert.equal(playerLanguageMatches('English', 'en'), true);
    assert.equal(playerLanguageMatches('eng', 'en'), true);
    assert.equal(playerLanguageMatches('es', 'en'), false);

    const audioTracks = [
        { id: '20', language: 'Japanese', languageTag: 'ja', selected: true },
        { id: '21', language: 'English', languageTag: 'en' },
    ];
    const subtitles = [
        { id: '40', language: 'English', languageTag: 'en', forced: true },
        { id: '41', language: 'English', languageTag: 'en', forced: false },
        { id: '42', language: 'Spanish', languageTag: 'es', forced: false, selected: true },
    ];
    assert.equal(pickPlayerAudioStreamId(audioTracks, 'en'), '21');
    assert.equal(pickPlayerAudioStreamId(audioTracks, ''), '20');
    assert.equal(pickPlayerSubtitleStreamId(subtitles, 'off', 'en'), null);
    assert.equal(pickPlayerSubtitleStreamId(subtitles, 'forced', 'en'), '40');
    assert.equal(pickPlayerSubtitleStreamId(subtitles, 'always', 'en'), '41');
    assert.equal(pickPlayerSubtitleStreamId(subtitles, 'always', 'es'), '42');
    assert.equal(pickPlayerSubtitleStreamId([
        { id: '50', codec: 'pgs', forced: true, languageTag: 'en' },
        { id: '51', codec: 'srt', languageTag: 'en' },
    ], 'forced', 'en', { allowImageSubtitles: false }), null);
    assert.equal(pickPlayerSubtitleStreamId([
        { id: '50', codec: 'pgs', forced: true, languageTag: 'en' },
        { id: '51', codec: 'srt', languageTag: 'en' },
    ], 'always', 'en', { allowImageSubtitles: false }), '51');
    assert.equal(mapPlayerPlaybackOptions({
        Media: [{
            Part: [{
                Stream: [
                    { id: 1, streamType: 1, codec: 'hevc' },
                    { id: 50, streamType: 3, codec: 'pgs', forced: true },
                ],
            }],
        }],
    }, { allowImageSubtitles: false }).subtitleStreamId, null);

    const preferred = mapPlayerPlaybackOptions({
        Media: [{
            Part: [{
                Stream: [
                    { id: 1, streamType: 1, height: 1080, codec: 'h264' },
                    { id: 20, streamType: 2, selected: true, codec: 'aac', language: 'Japanese', languageTag: 'ja' },
                    { id: 21, streamType: 2, codec: 'aac', language: 'English', languageTag: 'en' },
                    { id: 40, streamType: 3, codec: 'srt', language: 'English', languageTag: 'en', forced: true },
                    { id: 41, streamType: 3, codec: 'srt', language: 'English', languageTag: 'en' },
                ],
            }],
        }],
    }, { audioLanguage: 'en', subtitleMode: 'always' });
    assert.equal(preferred.audioStreamId, '21');
    assert.equal(preferred.subtitleStreamId, '41');
});
