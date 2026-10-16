import assert from 'node:assert/strict';
import test from 'node:test';
import {
    conditionsToFieldState,
    describeMatchRule,
    fieldStateToConditions,
    formatMatchThreshold,
    moveListItem,
    normalizeMatchFilters,
    normalizeSearchApproaches,
    normalizeTextProcessing,
    parseMatchFilter,
    serializeMatchFilter,
    serializeMatchFilters,
    serializeSearchApproaches,
    serializeTextProcessing,
} from './spotify-to-plex-matching-config.js';

test('parseMatchFilter understands exact, contains, and similarity rules', () => {
    assert.deepEqual(parseMatchFilter('artist:match AND title:match').conditions, [
        { field: 'artist', op: 'match' },
        { field: 'title', op: 'match' },
    ]);
    assert.deepEqual(parseMatchFilter('artist:match AND title:similarity>=0.8').conditions, [
        { field: 'artist', op: 'match' },
        { field: 'title', op: 'similarity', threshold: 0.8 },
    ]);
    assert.equal(parseMatchFilter('artist:match OR title:match').parsed, false);
});

test('serializeMatchFilter round-trips structured rules', () => {
    const raw = 'artist:similarity>=0.85 AND title:similarity>=0.85';
    const parsed = parseMatchFilter(raw);
    assert.equal(serializeMatchFilter(parsed), raw);
    assert.equal(
        serializeMatchFilter({
            parsed: true,
            conditions: [{ field: 'artist', op: 'match' }, { field: 'title', op: 'contains' }],
        }),
        'artist:match AND title:contains',
    );
});

test('field state ignores unused album checks', () => {
    const fields = conditionsToFieldState([{ field: 'artist', op: 'match' }, { field: 'title', op: 'contains' }]);
    assert.equal(fields.album.op, 'off');
    assert.deepEqual(fieldStateToConditions(fields), [
        { field: 'artist', op: 'match' },
        { field: 'title', op: 'contains' },
    ]);
});

test('normalize and serialize match filters keep custom strings', () => {
    const rules = normalizeMatchFilters(['artist:match AND title:match', 'not a valid filter']);
    assert.equal(rules[0].parsed, true);
    assert.equal(rules[1].parsed, false);
    assert.deepEqual(serializeMatchFilters(rules), [
        'artist:match AND title:match',
        'not a valid filter',
    ]);
});

test('search approaches keep trim vs trimmed key', () => {
    const approaches = normalizeSearchApproaches([
        { id: 'normal', filtered: false, trim: false },
        { id: 'fast', filtered: true, trimmed: true },
    ]);
    assert.equal(approaches[0].trimKey, 'trim');
    assert.equal(approaches[1].trimKey, 'trimmed');
    assert.equal(approaches[1].trim, true);
    const saved = serializeSearchApproaches(approaches);
    assert.equal(saved[0].trim, false);
    assert.equal(saved[1].trimmed, true);
    assert.equal(Object.hasOwn(saved[1], 'trim'), false);
});

test('text processing preserves extra keys and ignored phrases', () => {
    const text = normalizeTextProcessing({
        filterOutWords: ['remastered', 'radio edit'],
        filterOutQuotes: true,
        mystery: 'keep-me',
    });
    assert.deepEqual(text.filterOutWords, ['remastered', 'radio edit']);
    assert.equal(text.filterOutQuotes, true);
    assert.equal(text.extra.mystery, 'keep-me');
    assert.deepEqual(serializeTextProcessing(text), {
        mystery: 'keep-me',
        filterOutWords: ['remastered', 'radio edit'],
        filterOutQuotes: true,
    });
});

test('helpers format thresholds and move list items', () => {
    assert.equal(formatMatchThreshold(0.851), '0.85');
    assert.equal(formatMatchThreshold(80), '0.8');
    assert.deepEqual(moveListItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
    assert.match(describeMatchRule(parseMatchFilter('artist:match AND title:similarity>=0.8')), /Artist exact/);
});
