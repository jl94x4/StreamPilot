import assert from 'node:assert/strict';
import test from 'node:test';
import { subtitleFormatName, subtitleTrackLabel } from './subtitleLabel.js';

test('subtitleFormatName maps Plex codecs', () => {
    assert.equal(subtitleFormatName('pgs'), 'PGS');
    assert.equal(subtitleFormatName('srt'), 'SRT');
    assert.equal(subtitleFormatName('vobsub'), 'VobSub');
    assert.equal(subtitleFormatName('weird'), 'WEIRD');
    assert.equal(subtitleFormatName(''), '');
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
