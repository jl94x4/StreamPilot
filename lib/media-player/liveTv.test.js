import assert from 'node:assert/strict';
import test from 'node:test';
import {
    epgPrefixCandidates,
    epgPrefixesFromProviders,
    clipGuideWindow,
    guideHasAirings,
    liveTvGridQueries,
    epgPrefixFromLineup,
    epgPrefixFromProviders,
    livePlaybackPath,
    livePlaylistCandidates,
    isHlsPlaylistBody,
    liveTvGuideWindow,
    mapLiveTvChannels,
    mapLiveTvDvrs,
    mapLiveTvGuide,
    isLivePosterArtUrl,
    liveAiringNeedsLibraryArt,
    onNowFromGuide,
    parseLiveTvTune,
    redactLiveUrl,
    unixSeconds,
} from './liveTv.js';

test('unix seconds accepts unix, millis, and ISO dates', () => {
    assert.equal(unixSeconds(1700000000), 1700000000);
    assert.equal(unixSeconds(1700000000000), 1700000000);
    assert.equal(unixSeconds('2024-01-15T12:00:00Z'), Date.parse('2024-01-15T12:00:00Z') / 1000);
});

test('redactLiveUrl hides tokens', () => {
    assert.match(redactLiveUrl('http://pms:32400/a.m3u8?X-Plex-Token=secret'), /X-Plex-Token=…/);
});

test('session JSON is not treated as an HLS playlist', () => {
    assert.equal(isHlsPlaylistBody('{"MediaContainer":{"size":1}}'), false);
    assert.equal(isHlsPlaylistBody('#EXTM3U\n#EXT-X-VERSION:3'), true);
});

test('epg prefix from Tunarr XMLTV lineup', () => {
    assert.equal(
        epgPrefixFromLineup('lineup://tv.plex.providers.epg.xmltv/tunarr'),
        '/tv.plex.providers.epg.xmltv',
    );
});

test('epg prefix from media providers grid feature', () => {
    const prefix = epgPrefixFromProviders({
        MediaContainer: {
            MediaProvider: [{
                identifier: 'tv.plex.providers.epg.xmltv',
                Feature: [{ key: '/tv.plex.providers.epg.xmltv:3/grid' }],
            }],
        },
    });
    assert.equal(prefix, '/tv.plex.providers.epg.xmltv:3');
});

test('maps DVR list from OpenAPI-shaped JSON', () => {
    const dvrs = mapLiveTvDvrs({
        MediaContainer: {
            Dvr: [{
                key: '28',
                language: 'eng',
                lineup: 'lineup://tv.plex.providers.epg.xmltv/tunarr',
                uuid: 'abc',
                Device: [{
                    make: 'Tunarr',
                    model: 'HDHomeRun',
                    tuners: '4',
                    ChannelMapping: [
                        { channelKey: 'ch-1', deviceIdentifier: '1.1', enabled: '1' },
                    ],
                }],
            }],
        },
    }, { id: 'srv', name: 'Home' });
    assert.equal(dvrs.length, 1);
    assert.equal(dvrs[0].id, '28');
    assert.equal(dvrs[0].epgPrefix, '/tv.plex.providers.epg.xmltv');
    assert.equal(dvrs[0].channelMappings[0].deviceIdentifier, '1.1');
});

test('maps channels and a guide window', () => {
    const channels = mapLiveTvChannels({
        MediaContainer: {
            Channel: [
                { key: '101', identifier: '1.1', title: 'BBC One', callSign: 'BBC1' },
            ],
        },
    }, { dvrId: '28', serverId: 'srv' });
    assert.equal(channels[0].number, '1.1');
    const guide = mapLiveTvGuide({
        MediaContainer: {
            Channel: [{
                key: '101',
                identifier: '1.1',
                title: 'BBC One',
                Video: [{
                    ratingKey: '900',
                    title: 'News',
                    grandparentTitle: 'BBC News',
                    beginsAt: 1700000000,
                    endsAt: 1700003600,
                    summary: 'Headlines',
                }],
            }],
        },
    }, channels, { serverId: 'srv' });
    assert.equal(guide[0].airings[0].type, 'liveAiring');
    assert.equal(guide[0].airings[0].liveStartsAt, 1700000000);
    const onNow = onNowFromGuide(guide, 1700001000);
    assert.equal(onNow.length, 1);
    assert.equal(onNow[0].episodeTitle, 'News');
});

test('tune parse prefers part key then metadata path', () => {
    const tune = parseLiveTvTune({
        MediaContainer: {
            Metadata: [{
                ratingKey: '55',
                key: '/library/metadata/55',
                Media: [{ Part: [{ key: '/library/parts/9/file.m3u8', session: 'live-1' }] }],
            }],
        },
    });
    assert.equal(tune.ratingKey, '55');
    assert.equal(livePlaybackPath(tune), '/livetv/sessions/live-1/0/index.m3u8');
});

test('guide window is now-30m to +N hours', () => {
    const window = liveTvGuideWindow(1_700_000_000_000, 3);
    assert.equal(window.endsAt - window.startsAt, 3 * 3600);
});

// PMS grid shape: flat airings, channel + times on each Media entry.
const flatGrid = {
    MediaContainer: {
        Metadata: [
            {
                ratingKey: '901', type: 'movie', title: 'The Academy of Magic',
                Media: [{ beginsAt: 1000, endsAt: 4600, channelIdentifier: '1', channelVcn: '1', channelTitle: 'SubZero', channelThumb: '/ch/1.png' }],
            },
            {
                ratingKey: '902', type: 'movie', title: 'Alvin and the Chipmunks',
                Media: [{ beginsAt: 4600, endsAt: 9000, channelIdentifier: '1', channelVcn: '1', channelTitle: 'SubZero' }],
            },
            {
                ratingKey: '903', type: 'episode', grandparentTitle: 'News', title: 'Late edition',
                Media: [{ beginsAt: 1000, endsAt: 2800, channelIdentifier: '2', channelVcn: '2', channelTitle: 'Two' }],
            },
        ],
    },
};

test('flat PMS grid groups airings by channel and names channels from the guide', () => {
    // DVR mapping knew channel "1" by number only.
    const channels = [{ id: '46', channelKey: '46', number: '1', title: '1', callSign: '1', dvrId: '7', serverId: 's1' }];
    const rows = mapLiveTvGuide(flatGrid, channels, { dvrId: '7', serverId: 's1' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].channel.id, '46');
    assert.equal(rows[0].channel.title, 'SubZero');
    assert.equal(rows[0].channel.thumb, '/ch/1.png');
    assert.deepEqual(rows[0].airings.map((a) => a.title), ['The Academy of Magic', 'Alvin and the Chipmunks']);
    assert.equal(rows[0].airings[0].liveStartsAt, 1000);
    assert.equal(rows[0].airings[0].liveEndsAt, 4600);
    assert.equal(rows[0].airings[0].liveChannelId, '1');
    assert.equal(rows[1].channel.title, 'Two');
    assert.equal(rows[1].airings[0].showTitle, 'News');
    assert.equal(rows[1].airings[0].episodeTitle, 'Late edition');
});

test('a known channel with nothing in the window still gets a row', () => {
    const channels = [{ id: '99', channelKey: '99', number: '9', title: '9', dvrId: '7', serverId: 's1' }];
    const rows = mapLiveTvGuide(flatGrid, channels, {});
    assert.ok(rows.some((row) => row.channel.id === '99' && row.airings.length === 0));
});

test('grid queries try PMS filter syntax first, and clipping keeps the window', () => {
    assert.match(liveTvGridQueries(10, 20)[0], /endsAt>=10&beginsAt<=20/);
    const rows = mapLiveTvGuide(flatGrid, [], {});
    assert.ok(guideHasAirings(rows, 0, 5000));
    const clipped = clipGuideWindow(rows, 5000, 6000);
    assert.deepEqual(clipped[0].airings.map((a) => a.title), ['Alvin and the Chipmunks']);
    assert.equal(clipped[1].airings.length, 0);
});

test('guide address uses the provider number, not the bare lineup prefix', () => {
    const providers = { MediaContainer: { MediaProvider: [
        { identifier: 'com.plexapp.plugins.library' },
        { identifier: 'tv.plex.providers.epg.xmltv:41', Feature: [{ key: '/tv.plex.providers.epg.xmltv:41/grid', type: 'grid' }] },
    ] } };
    const prefixes = epgPrefixesFromProviders(providers);
    assert.deepEqual(prefixes, ['/tv.plex.providers.epg.xmltv:41']);
    const dvr = { id: '41', lineup: 'lineup://tv.plex.providers.epg.xmltv/http://tunarr:8000/api/xmltv.xml#Tunarr', epgPrefix: '/tv.plex.providers.epg.xmltv' };
    const candidates = epgPrefixCandidates(dvr, prefixes);
    assert.equal(candidates[0], '/tv.plex.providers.epg.xmltv:41');
    assert.equal(candidates[candidates.length - 1], '/tv.plex.providers.epg.xmltv');
    // Without providers, the <type>:<dvrId> form still comes before the bare prefix.
    assert.deepEqual(epgPrefixCandidates(dvr, []), ['/tv.plex.providers.epg.xmltv:41', '/tv.plex.providers.epg.xmltv']);
});

test('tune reply: finds the stream inside MediaSubscription > MediaGrabOperation', () => {
    const tuned = { MediaContainer: { MediaSubscription: [{ MediaGrabOperation: [{ Metadata: {
        ratingKey: '777', title: 'Channel 1',
        Media: [{ Part: [{ key: '/livetv/sessions/abc-123/0/index.m3u8' }] }],
    } }] }] } };
    const parsed = parseLiveTvTune(tuned);
    assert.equal(parsed.partKey, '/livetv/sessions/abc-123/0/index.m3u8');
    assert.equal(parsed.sessionId, 'abc-123');
    assert.equal(livePlaybackPath(parsed), '/livetv/sessions/abc-123/0/index.m3u8');
});

test('live stream path never points the TV at the tuner or an internal host', () => {
    // Tuner source URL in the tune reply: dropped, play the live session through PMS instead.
    const tunerReply = { MediaContainer: { MediaSubscription: [{ MediaGrabOperation: [{ Metadata: {
        key: '/livetv/sessions/sess-9',
        Media: [{ Part: [{ key: 'http://tunarr.lan:8000/stream/channel/2' }] }],
    } }] }] } };
    assert.equal(livePlaybackPath(parseLiveTvTune(tunerReply)), '/livetv/sessions/sess-9/0/index.m3u8');
    // Internal absolute PMS URL: rebased to its path, keep the playlist file.
    const internal = { MediaContainer: { Metadata: { Media: [{ Part: [{ key: 'http://127.0.0.1:32400/livetv/sessions/abc/0/index.m3u8?x=1' }] }] } } };
    assert.equal(livePlaybackPath(parseLiveTvTune(internal)), '/livetv/sessions/abc/0/index.m3u8');
    assert.deepEqual(livePlaylistCandidates(parseLiveTvTune(internal))[0], '/livetv/sessions/abc/0/index.m3u8');
    assert.ok(livePlaylistCandidates(parseLiveTvTune(internal)).every((path) => path.endsWith('.m3u8')));
    assert.ok(!livePlaylistCandidates({ sessionId: 'cbb77490-0789-4319-be56-e6289677891c' }).includes(
        '/livetv/sessions/cbb77490-0789-4319-be56-e6289677891c',
    ));
});

test('mapLiveTvChannels reads lineup channel rows (id / gridKey / vcn)', () => {
    const rows = mapLiveTvChannels({ MediaContainer: { Channel: [
        { id: 'C1.49.tunarr.com', gridKey: 'C1.49.tunarr.com', vcn: '1', title: '1 British TV', thumb: 'http://x/t.png' },
        { id: 'C2.50.tunarr.com', gridKey: 'C2.50.tunarr.com', vcn: '2', title: '2 UKTV' },
    ] } }, { dvrId: '53', serverId: 's' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'C1.49.tunarr.com');
    assert.equal(rows[0].number, '1');
    assert.equal(rows[0].title, '1 British TV');
    assert.equal(rows[0].thumb, 'http://x/t.png');
});

test('mapLiveTvGuide uses an episode poster, not the channel logo', () => {
    const channels = mapLiveTvChannels({ MediaContainer: { Channel: [
        { id: 'C2.50.tunarr.com', vcn: '2', title: '2 UKTV', thumb: 'http://t/images/tunarr.png' },
    ] } }, { dvrId: '53', serverId: 's' });
    const rows = mapLiveTvGuide({ MediaContainer: { Metadata: [{
        ratingKey: 'e1', type: 'episode', title: 'Ep', grandparentTitle: 'Show',
        grandparentThumb: 'http://t/api/programs/1/artwork/poster',
        Media: [{ beginsAt: 100, endsAt: 200, channelIdentifier: 'C2.50.tunarr.com', channelVcn: '2' }],
    }] } }, channels, { dvrId: '53', serverId: 's' });
    assert.equal(rows[0].airings[0].thumb, 'http://t/api/programs/1/artwork/poster');
    assert.equal(rows[0].airings[0].art, null);
    assert.equal(liveAiringNeedsLibraryArt(rows[0].airings[0]), true);
});

test('mapLiveTvGuide keeps wide art and ignores a poster stamped into art', () => {
    const channels = mapLiveTvChannels({ MediaContainer: { Channel: [
        { id: 'C1', vcn: '1', title: 'One' },
    ] } }, { dvrId: '53', serverId: 's' });
    const withBackdrop = mapLiveTvGuide({ MediaContainer: { Metadata: [{
        ratingKey: 'e2', type: 'episode', title: 'Ep', grandparentTitle: 'Citizen Khan',
        grandparentThumb: 'http://t/api/programs/1/artwork/poster',
        grandparentArt: 'http://t/api/programs/1/artwork/fanart',
        Media: [{ beginsAt: 100, endsAt: 200, channelIdentifier: 'C1', channelVcn: '1' }],
    }] } }, channels, { dvrId: '53', serverId: 's' });
    assert.equal(withBackdrop[0].airings[0].art, 'http://t/api/programs/1/artwork/fanart');
    assert.equal(liveAiringNeedsLibraryArt(withBackdrop[0].airings[0]), false);

    const posterAsArt = mapLiveTvGuide({ MediaContainer: { Metadata: [{
        ratingKey: 'e3', type: 'episode', title: 'Ep', grandparentTitle: 'Show',
        art: 'http://t/api/programs/2/artwork/poster',
        thumb: 'http://t/api/programs/2/artwork/poster',
        Media: [{ beginsAt: 100, endsAt: 200, channelIdentifier: 'C1', channelVcn: '1' }],
    }] } }, channels, { dvrId: '53', serverId: 's' });
    assert.equal(posterAsArt[0].airings[0].art, null);
    assert.equal(isLivePosterArtUrl('http://t/api/programs/2/artwork/poster'), true);
});
