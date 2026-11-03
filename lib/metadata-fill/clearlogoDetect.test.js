import assert from 'node:assert/strict';
import test from 'node:test';
import {
    classifyClearLogoCoverage,
    hasSelectedClearLogoOnMeta,
    normalizeClearLogoList,
    pickBestClearLogoCandidate,
} from './clearlogoDetect.js';

test('hasSelectedClearLogoOnMeta detects Image clearLogo', () => {
    assert.equal(hasSelectedClearLogoOnMeta({
        Image: [{ type: 'clearLogo', url: '/library/metadata/1/clearLogo' }],
    }), true);
    assert.equal(hasSelectedClearLogoOnMeta({
        Image: [{ type: 'background', url: '/library/metadata/1/art' }],
    }), false);
    assert.equal(hasSelectedClearLogoOnMeta({}), false);
});

test('normalizeClearLogoList maps MediaContainer Photos', () => {
    const rows = normalizeClearLogoList({
        MediaContainer: {
            Metadata: [
                { ratingKey: 'metadata://a', provider: 'com.plexapp.agents.themoviedb', selected: '0', thumb: '/t/a' },
                { ratingKey: 'metadata://b', provider: 'local', selected: true, thumb: '/t/b' },
            ],
        },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ratingKey, 'metadata://a');
    assert.equal(rows[1].selected, true);
});

test('classifyClearLogoCoverage: hasLogo when selected in list', () => {
    const result = classifyClearLogoCoverage({
        clearLogos: [
            { ratingKey: 'metadata://a', selected: false },
            { ratingKey: 'metadata://b', selected: true },
        ],
    });
    assert.equal(result.status, 'hasLogo');
    assert.equal(result.selected.ratingKey, 'metadata://b');
});

test('classifyClearLogoCoverage: available when candidates but none selected', () => {
    const result = classifyClearLogoCoverage({
        metadata: { Image: [{ type: 'coverPoster', url: '/p' }] },
        clearLogos: [
            { ratingKey: 'metadata://a', provider: 'com.plexapp.agents.themoviedb', selected: false },
            { ratingKey: 'metadata://b', provider: 'local', selected: '0' },
        ],
    });
    assert.equal(result.status, 'available');
    assert.equal(result.count, 2);
});

test('classifyClearLogoCoverage: none when empty', () => {
    assert.equal(classifyClearLogoCoverage({ clearLogos: [] }).status, 'none');
});

test('classifyClearLogoCoverage: hasLogo from metadata Image alone', () => {
    const result = classifyClearLogoCoverage({
        metadata: { Image: [{ type: 'clearLogo', url: '/library/metadata/9/clearLogo' }] },
        clearLogos: [],
    });
    assert.equal(result.status, 'hasLogo');
});

test('pickBestClearLogoCandidate prefers agent over local', () => {
    const hit = pickBestClearLogoCandidate([
        { ratingKey: 'upload://x', provider: 'local', selected: false },
        { ratingKey: 'metadata://tmdb', provider: 'com.plexapp.agents.themoviedb', selected: false },
    ]);
    assert.equal(hit.ratingKey, 'metadata://tmdb');
});

test('pickBestClearLogoCandidate skips already-selected rows', () => {
    const hit = pickBestClearLogoCandidate([
        { ratingKey: 'metadata://a', provider: 'com.plexapp.agents.themoviedb', selected: true },
        { ratingKey: 'metadata://b', provider: 'local', selected: false },
    ]);
    assert.equal(hit.ratingKey, 'metadata://b');
});
