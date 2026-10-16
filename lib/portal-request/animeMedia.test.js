import assert from 'node:assert/strict';
import test from 'node:test';
import {
    detectAnimeMedia,
    inferAnimeRootFolderPath,
    resolveAnimeAwareRootFolder,
    TMDB_ANIME_KEYWORD_ID,
    TMDB_ANIMATION_GENRE_ID,
} from './animeMedia.js';

test('detectAnimeMedia uses Seerr anime keyword and explicit flag', () => {
    assert.equal(detectAnimeMedia({ isAnime: true }, { mediaType: 'tv' }), true);
    assert.equal(detectAnimeMedia({
        keywords: [{ id: TMDB_ANIME_KEYWORD_ID, name: 'anime' }],
    }, { mediaType: 'movie' }), true);
    assert.equal(detectAnimeMedia({ keywords: [{ id: 1, name: 'superhero' }] }, { mediaType: 'movie' }), false);
});

test('detectAnimeMedia is Japanese anime only, not Western animation', () => {
    assert.equal(detectAnimeMedia({
        originalLanguage: 'en',
        originCountry: ['US'],
        genres: [{ id: TMDB_ANIMATION_GENRE_ID, name: 'Animation' }],
        keywords: [],
    }, { mediaType: 'tv' }), false);
    assert.equal(detectAnimeMedia({
        originalLanguage: 'ja',
        originCountry: ['JP'],
        genres: [{ id: TMDB_ANIMATION_GENRE_ID, name: 'Animation' }],
        keywords: [],
    }, { mediaType: 'tv' }), true);
    assert.equal(detectAnimeMedia({
        originalLanguage: 'ja',
        originCountry: ['JP'],
        genres: [{ id: 18, name: 'Drama' }],
        keywords: [],
    }, { mediaType: 'tv' }), false);
    assert.equal(detectAnimeMedia({
        originalLanguage: 'ja',
        originCountry: ['JP'],
        genres: [{ id: TMDB_ANIMATION_GENRE_ID, name: 'Animation' }],
        keywords: [],
    }, { mediaType: 'movie' }), true);
    assert.equal(detectAnimeMedia({
        originalLanguage: 'en',
        genres: [{ id: TMDB_ANIMATION_GENRE_ID, name: 'Animation' }],
    }, { mediaType: 'movie' }), false);
});

test('resolveAnimeAwareRootFolder prefers Seerr anime directory then named animation folders', () => {
    const folders = [
        { path: '/mnt/ext/Videos/TV/Series TV' },
        { path: '/mnt/ext/Videos/TV/Series TV Animés' },
    ];
    assert.equal(resolveAnimeAwareRootFolder({
        isAnime: true,
        activeAnimeDirectory: '/mnt/ext/Videos/TV/Series TV Animés',
        activeDirectory: '/mnt/ext/Videos/TV/Series TV',
        rootFolders: folders,
    }), '/mnt/ext/Videos/TV/Series TV Animés');
    assert.equal(resolveAnimeAwareRootFolder({
        isAnime: true,
        activeDirectory: '/mnt/ext/Videos/TV/Series TV',
        rootFolders: folders,
    }), '/mnt/ext/Videos/TV/Series TV Animés');
    assert.equal(resolveAnimeAwareRootFolder({
        isAnime: false,
        activeDirectory: '/mnt/ext/Videos/TV/Series TV',
        rootFolders: folders,
    }), '/mnt/ext/Videos/TV/Series TV');
});

test('detectAnimeMedia reads nested TMDB keyword payloads', () => {
    assert.equal(detectAnimeMedia({
        keywords: { results: [{ id: TMDB_ANIME_KEYWORD_ID, name: 'anime' }] },
    }, { mediaType: 'tv' }), true);
});

test('inferAnimeRootFolderPath finds animés/anime folders', () => {
    assert.equal(inferAnimeRootFolderPath([
        { path: '/tv' },
        { path: '/tv/Series TV Animés' },
    ]), '/tv/Series TV Animés');
    assert.equal(inferAnimeRootFolderPath([{ path: '/tv/Series TV' }]), null);
    assert.equal(inferAnimeRootFolderPath([{ path: '/tv' }]), null);
});
