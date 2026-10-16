import assert from 'node:assert/strict';
import {
    buildArrPortalEmbedHref,
    findMatchingArrEmbedTab,
    isSafeArrEmbedPath,
    readArrEmbedQuery,
    resolveArrEmbedPath,
} from './arr-portal-embed.js';

const radarrTab = {
    id: 'radarr-tab',
    name: 'Radarr',
    url: 'https://radarr.example.com/',
    openMode: 'embed',
    enabled: true,
};
const sonarrTab = {
    id: 'sonarr-tab',
    name: 'TV',
    url: 'https://sonarr.example.com',
    logoUrl: '/applets/sonarr.png',
    openMode: 'embed',
    enabled: true,
};

assert.equal(isSafeArrEmbedPath('movie/123'), true);
assert.equal(isSafeArrEmbedPath('series/the-whisper-man?foo=1'), true);
assert.equal(isSafeArrEmbedPath('../etc/passwd'), false);
assert.equal(isSafeArrEmbedPath(''), false);

assert.equal(
    resolveArrEmbedPath('https://radarr.example.com/', 'https://radarr.example.com/movie/123'),
    'movie/123',
);
assert.equal(
    resolveArrEmbedPath('https://radarr.example.com/radarr', 'https://radarr.example.com/radarr/movie/123'),
    'movie/123',
);
assert.equal(
    resolveArrEmbedPath('https://sonarr.example.com/', 'http://192.168.1.10:8989/series/the-whisper-man'),
    'series/the-whisper-man',
);

assert.equal(
    findMatchingArrEmbedTab([radarrTab, sonarrTab], 'https://radarr.example.com/movie/9', 'radarr')?.id,
    'radarr-tab',
);
assert.equal(
    findMatchingArrEmbedTab([radarrTab, sonarrTab], 'http://192.168.1.10:8989/series/foo', 'sonarr')?.id,
    'sonarr-tab',
);
assert.equal(
    findMatchingArrEmbedTab([radarrTab], 'https://lidarr.example.com/artist/x', 'lidarr'),
    null,
);

assert.equal(
    buildArrPortalEmbedHref('radarr-tab', 'movie/123'),
    '/external/radarr-tab?embed=movie%2F123',
);
assert.equal(buildArrPortalEmbedHref('radarr-tab', '../x'), '/external/radarr-tab');
assert.equal(readArrEmbedQuery('?embed=movie%2F123'), 'movie/123');
assert.equal(readArrEmbedQuery('?embed=../x'), '');

console.log('arr-portal-embed tests passed');
