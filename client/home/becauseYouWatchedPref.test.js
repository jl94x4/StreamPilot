import test from 'node:test';
import assert from 'node:assert/strict';
import { userAllowsHomeBecauseYouWatched } from './becauseYouWatchedPref.js';

test('Because you watched Home rail defaults on', () => {
    assert.equal(userAllowsHomeBecauseYouWatched(undefined), true);
    assert.equal(userAllowsHomeBecauseYouWatched({}), true);
    assert.equal(userAllowsHomeBecauseYouWatched({ showHomeBecauseYouWatched: true }), true);
    assert.equal(userAllowsHomeBecauseYouWatched({ showHomeBecauseYouWatched: false }), false);
});
