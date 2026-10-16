import assert from 'node:assert/strict';
import test from 'node:test';
import {
    asItemArray,
    buildLikedSongsPlaylist,
    buildSavedItemAddBody,
    fetchSpotifyAccountPlaylistPages,
    importSavedItemsFromSpotifyLink,
    isAlreadyAddedError,
    likedSongsItemId,
    mergeCatalogPlaylists,
    mergeSpotifyAccountLibrary,
    normalizeSpotifyAccountAlbums,
    normalizeSpotifyAccountPlaylists,
    normalizeSpotifySearchPlaylists,
    isSpotifyOwnedPlaylist,
    parseSpotifyMediaLink,
    resolveSpotifyLinkImports,
    savedItemIdSet,
    summarizeSpotifyLinkImport,
    uniqueAlbumsFromArtistPages,
} from './spotify-to-plex-playlist-import.js';

test('likedSongsItemId prefixes the Spotify user id', () => {
    assert.equal(likedSongsItemId('abc'), 'liked-abc');
});

test('isAlreadyAddedError matches worker duplicate messages', () => {
    assert.equal(isAlreadyAddedError('Discover Weekly (spotify id: 37i) is already added.'), true);
    assert.equal(isAlreadyAddedError('Invalid Spotify URI'), false);
});

test('normalizeSpotifyAccountPlaylists prepends Liked Songs and marks saved items', () => {
    const items = normalizeSpotifyAccountPlaylists([
        { id: 'pl1', title: 'Gym', private: true, owner: 'Jay', user_id: 'u1', added: false },
        { id: 'pl2', name: 'Public mix', private: false, owner: 'Spotify', added: true },
    ], {
        user: { id: 'u1', name: 'ItsThatJA' },
        savedIds: savedItemIdSet([{ id: 'liked-u1' }]),
    });
    assert.equal(items[0].id, 'liked-u1');
    assert.equal(items[0].search, 'ItsThatJA:liked');
    assert.equal(items[0].added, true);
    assert.equal(items[1].search, 'spotify:playlist:pl1');
    assert.equal(items[1].userId, 'u1');
    assert.equal(items[2].added, true);
});

test('buildSavedItemAddBody includes user_id for private account playlists', () => {
    assert.deepEqual(buildSavedItemAddBody({
        search: 'spotify:playlist:pl1',
        userId: 'u1',
    }), { search: 'spotify:playlist:pl1', user_id: 'u1' });
    assert.deepEqual(buildSavedItemAddBody({
        search: 'ItsThatJA:liked',
        userId: 'u1',
    }), { search: 'ItsThatJA:liked', user_id: 'u1' });
});

test('asItemArray ignores non-arrays', () => {
    assert.deepEqual(asItemArray({ error: 'nope' }), []);
    assert.deepEqual(asItemArray(null), []);
});

test('asItemArray unwraps items envelopes', () => {
    assert.deepEqual(asItemArray({ items: [{ id: 'pl1' }] }), [{ id: 'pl1' }]);
});

test('fetchSpotifyAccountPlaylistPages walks offset until a short page', async () => {
    const pages = [
        { items: [{ id: 'a' }, { id: 'b' }], total: 3 },
        { items: [{ id: 'c' }] },
    ];
    const raw = await fetchSpotifyAccountPlaylistPages(async ({ offset }) => pages[offset === 0 ? 0 : 1], { limit: 2 });
    assert.deepEqual(raw.map((item) => item.id), ['a', 'b', 'c']);
});

test('buildLikedSongsPlaylist uses the connected username', () => {
    const liked = buildLikedSongsPlaylist({ id: 'u1', name: 'Jay' });
    assert.equal(liked.id, 'liked-u1');
    assert.equal(liked.search, 'Jay:liked');
    assert.equal(liked.private, true);
    assert.equal(liked.kind, 'liked');
});

test('parseSpotifyMediaLink reads playlist, album, and artist URLs', () => {
    assert.deepEqual(parseSpotifyMediaLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), {
        kind: 'playlist', id: '37i9dQZF1DXcBWIGoYBM5M', uri: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M',
    });
    assert.equal(parseSpotifyMediaLink('https://open.spotify.com/intl-en/album/1ATL5GLyef0ax2vQltbXCX').kind, 'album');
    assert.equal(parseSpotifyMediaLink('https://open.spotify.com/embed/artist/0OdUWJ0sBjDrqHygGUXeCF').uri, 'spotify:artist:0OdUWJ0sBjDrqHygGUXeCF');
    assert.equal(parseSpotifyMediaLink('spotify:album:1ATL5GLyef0ax2vQltbXCX').kind, 'album');
    assert.equal(parseSpotifyMediaLink('https://example.com/album/nope'), null);
});

test('resolveSpotifyLinkImports normalizes albums and expands artists', async () => {
    const album = await resolveSpotifyLinkImports('https://open.spotify.com/intl-de/album/1ATL5GLyef0ax2vQltbXCX');
    assert.equal(album.kind, 'album');
    assert.equal(album.searches[0].search, 'spotify:album:1ATL5GLyef0ax2vQltbXCX');

    const artist = await resolveSpotifyLinkImports('spotify:artist:0OdUWJ0sBjDrqHygGUXeCF', {
        fetchArtist: async () => ({ name: 'Band' }),
        fetchArtistAlbums: async () => [
            { id: 'a1', name: 'First' },
            { id: 'a1', name: 'First deluxe' },
            { id: 'a2', name: 'Second' },
        ],
    });
    assert.equal(artist.kind, 'artist');
    assert.equal(artist.title, 'Band');
    assert.deepEqual(artist.searches.map((item) => item.id), ['a1', 'a2']);
});

test('resolveSpotifyLinkImports maps a track to its album', async () => {
    const result = await resolveSpotifyLinkImports('https://open.spotify.com/track/0lKUFDN6EFpbg5bnUfkkrl', {
        fetchTrack: async () => ({ album: { id: 'alb1', name: 'LP' } }),
    });
    assert.equal(result.kind, 'album');
    assert.equal(result.searches[0].search, 'spotify:album:alb1');
});

test('uniqueAlbumsFromArtistPages caps and de-duplicates', () => {
    const albums = uniqueAlbumsFromArtistPages([
        { id: 'a', name: 'A' },
        { id: 'a', name: 'A2' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
    ], { limit: 2 });
    assert.deepEqual(albums.map((item) => item.id), ['a', 'b']);
});

test('normalizeSpotifyAccountAlbums marks saved albums', () => {
    const albums = normalizeSpotifyAccountAlbums([
        { id: 'al1', title: 'LP', artists: [{ name: 'A' }], added: false },
        { album: { id: 'al2', name: 'Other', images: [{ url: 'http://img' }] } },
    ], { savedIds: savedItemIdSet([{ id: 'al2' }]) });
    assert.equal(albums[0].search, 'spotify:album:al1');
    assert.equal(albums[0].kind, 'album');
    assert.equal(albums[1].added, true);
    assert.equal(albums[1].image, 'http://img');
});

test('isSpotifyOwnedPlaylist matches editorial ids and Spotify owner', () => {
    assert.equal(isSpotifyOwnedPlaylist({ id: '37i9dQZF1DXcBWIGoYBM5M', owner: { id: 'other', display_name: 'DJ' } }), true);
    assert.equal(isSpotifyOwnedPlaylist({ id: 'userpl', owner: { id: 'spotify', display_name: 'Spotify' } }), true);
    assert.equal(isSpotifyOwnedPlaylist({ id: 'userpl', owner: 'Spotify' }), true);
    assert.equal(isSpotifyOwnedPlaylist({ id: 'userpl', owner: { id: 'jay', display_name: 'Jay' } }), false);
});

test('normalizeSpotifySearchPlaylists ranks Spotify-owned first and maps URIs', () => {
    const items = normalizeSpotifySearchPlaylists({
        playlists: {
            items: [
                { id: 'userpl', name: 'Gym', owner: { display_name: 'Jay' }, images: [{ url: 'http://a' }] },
                { id: '37i9dQZF1DX0XUs1Z1lmNH', name: 'Hot Hits USA', owner: { id: 'spotify', display_name: 'Spotify' } },
                null,
            ],
        },
    }, { savedIds: savedItemIdSet([{ id: '37i9dQZF1DX0XUs1Z1lmNH' }]) });
    assert.equal(items[0].id, '37i9dQZF1DX0XUs1Z1lmNH');
    assert.equal(items[0].editorial, true);
    assert.equal(items[0].added, true);
    assert.equal(items[0].search, 'spotify:playlist:37i9dQZF1DX0XUs1Z1lmNH');
    assert.equal(items[1].owner, 'Jay');
    assert.equal(items[1].editorial, false);
});

test('mergeCatalogPlaylists appends search hits that are not already listed', () => {
    const merged = mergeCatalogPlaylists(
        [{ id: 'pl1', title: 'Mine' }],
        [{ id: 'pl1', title: 'Mine again' }, { id: '37i9', title: 'Hot Hits USA' }],
    );
    assert.deepEqual(merged.map((item) => item.id), ['pl1', '37i9']);
});

test('mergeSpotifyAccountLibrary keeps liked songs then albums', () => {
    const merged = mergeSpotifyAccountLibrary({
        playlists: [{ id: 'pl1', kind: 'playlist' }],
        albums: [{ id: 'al1', kind: 'album' }, { id: 'pl1', kind: 'album' }],
    });
    assert.deepEqual(merged.map((item) => item.id), ['pl1', 'al1']);
});

test('importSavedItemsFromSpotifyLink skips albums that are already saved', async () => {
    const posted = [];
    const result = await importSavedItemsFromSpotifyLink({
        search: 'spotify:artist:0OdUWJ0sBjDrqHygGUXeCF',
        fetchArtist: async () => ({ name: 'Band' }),
        fetchArtistAlbums: async () => [{ id: 'a1', name: 'First' }, { id: 'a2', name: 'Second' }],
        postSavedItem: async (body) => {
            posted.push(body.search);
            if (body.search.includes('a1')) throw new Error('First (spotify id: a1) is already added.');
        },
        listSavedItems: async () => [{ id: 'a1' }, { id: 'a2' }],
    });
    assert.deepEqual(posted, ['spotify:album:a1', 'spotify:album:a2']);
    assert.deepEqual(result.addedIds, ['a2']);
    assert.deepEqual(result.syncIds, ['a2', 'a1']);
    assert.match(result.message, /Band/);
});

test('summarizeSpotifyLinkImport covers album and artist copy', () => {
    assert.match(summarizeSpotifyLinkImport({ kind: 'album', addedIds: ['x'] }), /Album added/);
    assert.match(summarizeSpotifyLinkImport({ kind: 'artist', title: 'Band', addedIds: ['a'], skippedIds: ['b'] }), /Band/);
});
