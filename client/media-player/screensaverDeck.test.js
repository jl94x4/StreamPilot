import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlayDeck } from './screensaverDeck.js';

const slides = [
    { key: 'a' },
    { key: 'b' },
    { key: 'c' },
    { key: 'd' },
    { key: 'e' },
    { key: 'f' },
];

test('buildPlayDeck keeps every slide and does not open on the one that just played', () => {
    const identity = () => 0.999999;
    const deck = buildPlayDeck(slides, 'a', identity);
    assert.deepEqual(deck.map((row) => row.key).sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
    assert.notEqual(deck[0].key, 'a');
    assert.equal(buildPlayDeck([{ key: 'only' }], 'only', identity)[0].key, 'only');
});

test('buildPlayDeck does not follow the source order', () => {
    let n = 0;
    const random = () => {
        n += 1;
        return (n % 5) / 5;
    };
    const deck = buildPlayDeck(slides, '', random);
    assert.notDeepEqual(deck.map((row) => row.key), slides.map((row) => row.key));
    assert.equal(deck.length, slides.length);
});
