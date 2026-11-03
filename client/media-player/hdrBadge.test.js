import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPlayerHdrLabel, playerHdrBadgeTitle } from './hdrBadge.js';

test('detectPlayerHdrLabel reads Dolby Vision from DOVIPresent', () => {
    assert.equal(detectPlayerHdrLabel({
        video: { DOVIPresent: true },
    }), 'DV');
    assert.equal(detectPlayerHdrLabel({
        video: {
            DOVIPresent: 1,
            displayTitle: '4K HDR10',
            colorTrc: 'smpte2084',
            colorPrimaries: 'bt2020',
        },
    }), 'DV HDR10');
});

test('detectPlayerHdrLabel distinguishes HDR10+ / HDR10 / HLG / HDR', () => {
    assert.equal(detectPlayerHdrLabel({
        video: { displayTitle: '2160p HDR10+' },
    }), 'HDR10+');
    assert.equal(detectPlayerHdrLabel({
        video: { videoDynamicRangeType: 'HDR10' },
    }), 'HDR10');
    assert.equal(detectPlayerHdrLabel({
        video: { colorTrc: 'arib-std-b67' },
    }), 'HLG');
    assert.equal(detectPlayerHdrLabel({
        video: { displayTitle: '4K HDR' },
    }), 'HDR');
});

test('detectPlayerHdrLabel falls back to filename tokens', () => {
    assert.equal(detectPlayerHdrLabel({
        fileName: 'Movie.2023.2160p.DV.HDR10.REMUX.mkv',
    }), 'DV HDR10');
    assert.equal(detectPlayerHdrLabel({
        fileName: 'Show.S01E01.1080p.HDR10Plus.WEB-DL.mkv',
    }), 'HDR10+');
    assert.equal(detectPlayerHdrLabel({
        fileName: 'Movie.DVD.Remux.mkv',
    }), null);
});

test('detectPlayerHdrLabel prefers the selected mediaInfo part', () => {
    assert.equal(detectPlayerHdrLabel({
        mediaIndex: 0,
        mediaInfo: [{
            parts: [{
                fileName: 'a.mkv',
                video: { DOVIPresent: true },
            }],
        }],
    }), 'DV');
    assert.equal(playerHdrBadgeTitle('DV HDR10'), 'Dolby Vision · HDR10');
});
