import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateKillRuleSessions, recountAfterStopped, sessionMatchesCondition } from './killRules.js';

const now = 1_800_000_000_000;
const stream = (over) => ({ sessionId: 's', user: 'Alex', state: 'playing', sessionLocation: 'wan', address: '1.1.1.1', ...over });

test('counts each user\'s streams and the places they come from', () => {
    const out = annotateKillRuleSessions([
        stream({ sessionId: 'a', address: '1.1.1.1' }),
        stream({ sessionId: 'b', address: '2.2.2.2' }),
        stream({ sessionId: 'c', user: 'Sam' }),
    ], { now });
    assert.equal(out[0].userStreamCount, 2);
    assert.equal(out[0].userLocationCount, 2);
    assert.equal(out[2].userStreamCount, 1);
    assert.equal(out[2].userLocationCount, 1);
});

test('every device at home is one place', () => {
    const out = annotateKillRuleSessions([
        stream({ sessionId: 'a', sessionLocation: 'lan', address: '192.168.1.10' }),
        stream({ sessionId: 'b', sessionLocation: 'lan', address: '192.168.1.11' }),
    ], { now });
    assert.equal(out[0].userLocationCount, 1);
});

test('paused minutes build up across checks and reset on resume', () => {
    const pausedSince = new Map();
    annotateKillRuleSessions([stream({ sessionId: 'p', state: 'paused' })], { now, pausedSince });
    const later = annotateKillRuleSessions([stream({ sessionId: 'p', state: 'paused' })], { now: now + 31 * 60_000, pausedSince });
    assert.equal(later[0].pausedMinutes, 31);
    const resumed = annotateKillRuleSessions([stream({ sessionId: 'p', state: 'playing' })], { now: now + 32 * 60_000, pausedSince });
    assert.equal(resumed[0].pausedMinutes, 0);
    assert.equal(pausedSince.has('p'), false);
});

test('finished streams are forgotten', () => {
    const pausedSince = new Map([['gone', now - 60_000]]);
    annotateKillRuleSessions([stream({ sessionId: 'x' })], { now, pausedSince });
    assert.equal(pausedSince.has('gone'), false);
});

test('new conditions match as numbers', () => {
    const [s] = annotateKillRuleSessions([stream({ sessionId: 'a' }), stream({ sessionId: 'b' }), stream({ sessionId: 'c' })], { now, hourOfDay: 21 });
    assert.equal(sessionMatchesCondition(s, { field: 'userStreamCount', operator: 'greater_than', value: '2' }), true);
    assert.equal(sessionMatchesCondition(s, { field: 'userStreamCount', operator: 'greater_than', value: '3' }), false);
    assert.equal(sessionMatchesCondition(s, { field: 'hourOfDay', operator: 'greater_than', value: '19' }), true);
    assert.equal(sessionMatchesCondition(s, { field: 'hourOfDay', operator: 'equals', value: '21' }), true);
});

test('a stream limit stops only the streams over it', () => {
    const sessions = annotateKillRuleSessions(['a', 'b', 'c'].map((id) => stream({ sessionId: id })), { now });
    const rule = { field: 'userStreamCount', operator: 'greater_than', value: '2' };
    const stopped = new Set();
    for (const session of sessions) {
        if (stopped.has(session.sessionId) || !sessionMatchesCondition(session, rule)) continue;
        stopped.add(session.sessionId);
        recountAfterStopped(sessions, stopped);
    }
    assert.deepEqual([...stopped], ['a']);
});

test('existing conditions still behave the same', () => {
    const s = { isTranscoding: true, bandwidth: 25_000, user: 'Alex', resolution: '4k' };
    assert.equal(sessionMatchesCondition(s, { field: 'isTranscoding', operator: 'equals', value: 'true' }), true);
    assert.equal(sessionMatchesCondition(s, { field: 'bandwidth', operator: 'greater_than', value: '20' }), true);
    assert.equal(sessionMatchesCondition(s, { field: 'user', operator: 'contains', value: 'ale' }), true);
    assert.equal(sessionMatchesCondition(s, { field: 'nope', operator: 'equals', value: 'x' }), false);
});
