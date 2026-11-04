import assert from 'node:assert/strict';
import test from 'node:test';
import { plexSessionSubtitle } from './sessionSubtitle.js';

const session = (streams) => ({ Media: [{ Part: [{ Stream: streams }] }] });

test('no subtitle stream means subtitles are off', () => {
    assert.equal(plexSessionSubtitle(session([{ streamType: 1 }, { streamType: 2 }])), null);
    assert.equal(plexSessionSubtitle({}), null);
});

test('picks the selected subtitle and its language', () => {
    const sub = plexSessionSubtitle(session([
        { streamType: 1 },
        { streamType: 3, languageCode: 'fre', displayTitle: 'French (SRT)' },
        { streamType: 3, selected: true, languageCode: 'eng', displayTitle: 'English (PGS)', decision: 'burn' },
    ]));
    assert.deepEqual(sub, { code: 'ENG', label: 'English (PGS)', forced: false, burn: true });
});

test('falls back to the only subtitle stream and to CC without a language', () => {
    const sub = plexSessionSubtitle(session([{ streamType: 3, forced: 1 }]));
    assert.equal(sub.code, '');
    assert.equal(sub.label, 'Subtitles');
    assert.equal(sub.forced, true);
    assert.equal(sub.burn, false);
});
