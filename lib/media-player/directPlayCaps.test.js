import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isSidecarSubtitleStream,
    partStreamSelectionQuery,
    subtitleCodecNeedsBurn,
} from './directPlayCaps.js';

test('native auto does not burn in-file PGS / VobSub / DVB', () => {
    assert.equal(subtitleCodecNeedsBurn('pgs', 'auto', true), false);
    assert.equal(subtitleCodecNeedsBurn('hdmv_pgs_subtitle', 'auto', true), false);
    assert.equal(subtitleCodecNeedsBurn('vobsub', 'auto', true), false);
    assert.equal(subtitleCodecNeedsBurn('dvbsub', 'auto', true), false);
    assert.equal(subtitleCodecNeedsBurn('xsub', 'auto', true), true);
    assert.equal(subtitleCodecNeedsBurn('pgs', 'image', true), true);
    assert.equal(subtitleCodecNeedsBurn('srt', 'always', true), true);
});

test('sidecar is an external streams file, not a muxed track with a download key', () => {
    assert.equal(isSidecarSubtitleStream({
        key: '/library/streams/99',
        codec: 'srt',
    }), true);
    assert.equal(isSidecarSubtitleStream({
        key: '/library/streams/99',
        index: 4,
        codec: 'pgs',
    }), false);
    assert.equal(isSidecarSubtitleStream({
        key: '/library/parts/12/file.mkv',
        codec: 'pgs',
    }), false);
    assert.equal(isSidecarSubtitleStream({
        location: 'external',
        codec: 'pgs',
    }), true);
    assert.equal(isSidecarSubtitleStream({ codec: 'pgs' }), false);
});

test('part stream selection saves the pick, with Off and OpenSubtitles sidecars as 0', () => {
    assert.equal(partStreamSelectionQuery('4242', '77'), 'audioStreamID=4242&subtitleStreamID=77&allParts=1');
    assert.equal(partStreamSelectionQuery('', ''), 'subtitleStreamID=0&allParts=1');
    assert.equal(partStreamSelectionQuery('10', '0'), 'audioStreamID=10&subtitleStreamID=0&allParts=1');
    assert.equal(partStreamSelectionQuery(null, 'os:abc123'), 'subtitleStreamID=0&allParts=1');
});
