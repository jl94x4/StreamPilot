import assert from 'node:assert/strict';
import {
    emptyOnboardingDocument,
    getEnabledOnboardingSteps,
    isOnboardingPending,
    markUserOnboardingComplete,
    markUserOnboardingPending,
    normalizeOnboardingDocument,
    validateOnboardingCompletion,
} from './onboarding.js';

const empty = emptyOnboardingDocument();
assert.equal(empty.enabled, false);
assert.ok(empty.steps.length >= 4);

const normalized = normalizeOnboardingDocument({
    enabled: true,
    version: 2,
    steps: [
        { id: 'welcome', type: 'welcome', title: 'Hi', body: 'Hello', order: 1 },
        { id: 'rules', type: 'rules', title: 'Rules', body: 'Be kind', requireAck: true, order: 0 },
        { id: 'bad', type: 'nope', title: 'Nope' },
        { id: 'welcome', type: 'welcome', title: 'Duplicate' },
    ],
});
assert.equal(normalized.enabled, true);
assert.equal(normalized.version, 2);
assert.equal(normalized.steps[0].id, 'rules');
assert.equal(normalized.steps[0].requireAck, true);
assert.equal(normalized.steps.some((s) => s.type === 'nope'), false);

assert.equal(isOnboardingPending({ onboardingCompleted: false }, normalized), true);
assert.equal(isOnboardingPending({}, normalized), false);
assert.equal(isOnboardingPending({ onboardingCompleted: false }, normalized, { isAdmin: true }), false);
assert.equal(isOnboardingPending({ onboardingCompleted: false }, { ...normalized, enabled: false }), false);

const pendingUser = markUserOnboardingPending({ id: 'u1', username: 'Sam' }, normalized);
assert.equal(pendingUser.onboardingCompleted, false);
assert.equal(pendingUser.onboardingVersion, 2);

const validation = validateOnboardingCompletion(normalized, []);
assert.equal(validation.ok, false);
assert.deepEqual(validation.missing, ['rules']);
assert.equal(validateOnboardingCompletion(normalized, ['rules']).ok, true);

const completed = markUserOnboardingComplete(pendingUser, normalized, ['rules']);
assert.equal(completed.onboardingCompleted, true);
assert.ok(completed.onboardingCompletedAt);
assert.deepEqual(completed.onboardingAckedStepIds, ['rules']);

assert.equal(getEnabledOnboardingSteps({
    enabled: true,
    steps: [
        { id: 'a', type: 'text', title: 'A', enabled: false },
        { id: 'b', type: 'text', title: 'B', enabled: true },
    ],
}).length, 1);

console.log('onboarding tests passed');
