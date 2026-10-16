import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { titleDiscoveryPath } from './titleDiscoveryPath.js';

describe('titleDiscoveryPath', () => {
    it('uses TMDB movie and TV ids when present', () => {
        assert.equal(titleDiscoveryPath({ title: 'Dune', tmdbId: 438631, type: 'movie' }), '/discovery/movie/438631');
        assert.equal(titleDiscoveryPath({ title: 'Severance', tmdbId: 95396, kind: 'tv' }), '/discovery/tv/95396');
        assert.equal(titleDiscoveryPath({ title: 'Severance', tmdbId: 95396, type: 'episode' }), '/discovery/tv/95396');
    });

    it('uses MusicBrainz artist ids for music', () => {
        assert.equal(
            titleDiscoveryPath({ title: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', type: 'music' }),
            '/discovery/music/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711',
        );
    });

    it('falls back to Discover search for wrap-up and last-watched titles', () => {
        assert.equal(titleDiscoveryPath({ title: 'Heat', type: 'movie' }), '/discovery?q=Heat');
        assert.equal(
            titleDiscoveryPath({ title: 'Cold Harbor', grandparentTitle: 'Severance', type: 'episode' }),
            '/discovery?q=Severance',
        );
        assert.equal(titleDiscoveryPath({ title: '  ' }), null);
        assert.equal(titleDiscoveryPath(null), null);
    });
});
