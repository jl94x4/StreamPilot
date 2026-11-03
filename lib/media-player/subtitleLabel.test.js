import assert from 'node:assert/strict';
import test from 'node:test';
import { isSubtitleStreamRow, subtitleCodecFromStream, subtitleFormatName, subtitleTrackLabel } from './subtitleLabel.js';

test('subtitleFormatName maps Plex codecs', () => {
    assert.equal(subtitleFormatName('pgs'), 'PGS');
    assert.equal(subtitleFormatName('srt'), 'SRT');
    assert.equal(subtitleFormatName('vobsub'), 'VobSub');
    assert.equal(subtitleFormatName('weird'), 'WEIRD');
    assert.equal(subtitleFormatName(''), '');
});

test('subtitleCodecFromStream reads Plex codec, format, and Matroska codecID', () => {
    assert.equal(subtitleCodecFromStream({ codec: 'pgs' }), 'pgs');
    assert.equal(subtitleCodecFromStream({ format: 'pgs' }), 'pgs');
    assert.equal(subtitleCodecFromStream({ codecID: 'S_HDMV/PGS' }), 'pgs');
    assert.equal(subtitleCodecFromStream({ codecId: 'S_VOBSUB' }), 'vobsub');
    assert.equal(isSubtitleStreamRow({ streamType: 3, codec: 'pgs' }), true);
    assert.equal(isSubtitleStreamRow({ codecID: 'S_HDMV/PGS' }), true);
    assert.equal(isSubtitleStreamRow({ streamType: 1, codec: 'hevc' }), false);
});

test('subtitleTrackLabel names PGS when only codecID is set', () => {
    assert.equal(subtitleTrackLabel({ language: 'English', codecID: 'S_HDMV/PGS' }), 'English (PGS)');
});

test('subtitleTrackLabel adds the format and Forced', () => {
    assert.equal(subtitleTrackLabel({ displayTitle: 'English', codec: 'pgs' }), 'English (PGS)');
    assert.equal(subtitleTrackLabel({ displayTitle: 'English (PGS)', codec: 'pgs' }), 'English (PGS)');
    assert.equal(subtitleTrackLabel({ displayTitle: 'English (PGS Forced)', codec: 'pgs', forced: 1 }), 'English Forced (PGS)');
    assert.equal(subtitleTrackLabel({ displayTitle: 'English', codec: 'pgs', forced: true }), 'English Forced (PGS)');
    assert.equal(subtitleTrackLabel({ language: 'Danish', codec: 'srt' }), 'Danish (SRT)');
    assert.equal(subtitleTrackLabel({ displayTitle: 'English (SDH)', codec: 'srt' }), 'English (SDH) (SRT)');
    assert.equal(subtitleTrackLabel({}), 'Subtitle');
});
