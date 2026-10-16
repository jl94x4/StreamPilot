import assert from 'node:assert/strict';
import {
    createReferralRewardEntry,
    emptyReferralRewardsDocument,
    findGrantedRewardForReferred,
    normalizeReferralRewardsDocument,
    prependReferralReward,
    sameAccount,
    summarizeReferrerRewards,
} from './referrals.js';

assert.deepEqual(emptyReferralRewardsDocument(), { rewards: [] });

assert.equal(sameAccount({ id: 'a', plexId: 'p1' }, { id: 'b', plexId: 'p1' }), true);
assert.equal(sameAccount({ id: 'a' }, { id: 'b' }), false);
assert.equal(sameAccount({ jellyfinId: 'jf-1' }, { id: 'jellyfin:jf-1', jellyfinId: 'jf-1' }), true);

const granted = createReferralRewardEntry({
    status: 'granted',
    referrer: { id: 'ref-1', plexId: 'ref-plex', username: 'John' },
    referred: { id: 'new-1', plexId: 'new-plex', username: 'Paul' },
    referralCode: 'ref-1',
    trialDays: 7,
    rewardDays: 30,
    previousExpiryDate: '2026-09-01T00:00:00.000Z',
    newExpiryDate: '2026-10-01T00:00:00.000Z',
});
assert.equal(granted.status, 'granted');
assert.equal(granted.rewardApplied, true);
assert.equal(granted.referrer.username, 'John');

const blocked = createReferralRewardEntry({
    status: 'blocked',
    blockReason: 'self_referral',
    referrer: { id: 'ref-1' },
    referred: { id: 'ref-1' },
    referralCode: 'ref-1',
    trialDays: 7,
    rewardDays: 30,
    rewardApplied: false,
});
assert.equal(blocked.blockReason, 'self_referral');

let doc = prependReferralReward(emptyReferralRewardsDocument(), granted);
doc = prependReferralReward(doc, blocked);
assert.equal(doc.rewards.length, 2);
assert.equal(findGrantedRewardForReferred(doc, { plexId: 'new-plex' })?.id, granted.id);
assert.equal(findGrantedRewardForReferred(doc, { plexId: 'other' }), null);

const summary = summarizeReferrerRewards(doc, { id: 'ref-1' });
assert.equal(summary.successfulReferrals, 1);
assert.equal(summary.totalBonusDays, 30);

const unlimited = createReferralRewardEntry({
    status: 'granted',
    referrer: { id: 'ref-1' },
    referred: { id: 'new-2', plexId: 'new-2' },
    rewardDays: 30,
    rewardApplied: false,
});
doc = prependReferralReward(doc, unlimited);
assert.equal(summarizeReferrerRewards(doc, { id: 'ref-1' }).totalBonusDays, 30);
assert.equal(summarizeReferrerRewards(doc, { id: 'ref-1' }).successfulReferrals, 2);

assert.equal(normalizeReferralRewardsDocument({ rewards: [null, { status: 'nope' }] }).rewards.length, 0);

console.log('referrals tests passed');
