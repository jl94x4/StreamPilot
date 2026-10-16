export const MAX_REFERRAL_REWARDS = 5000;

const makeId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `referral-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const asTrimmed = (value, max = 200) => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    return text.slice(0, max);
};

const asDays = (value, fallback = 0) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, 36500);
};

const asIso = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const party = (raw = {}) => ({
    id: asTrimmed(raw.id, 120),
    plexId: asTrimmed(raw.plexId, 120),
    jellyfinId: asTrimmed(raw.jellyfinId, 120),
    username: asTrimmed(raw.username, 120),
    email: asTrimmed(raw.email, 200),
});

export const emptyReferralRewardsDocument = () => ({ rewards: [] });

export const normalizeReferralReward = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const status = String(raw.status || '').trim();
    if (!['granted', 'blocked'].includes(status)) return null;
    const referrer = party(raw.referrer || {
        id: raw.referrerId,
        plexId: raw.referrerPlexId,
        username: raw.referrerUsername,
        email: raw.referrerEmail,
    });
    const referred = party(raw.referred || {
        id: raw.referredId,
        plexId: raw.referredPlexId,
        username: raw.referredUsername,
        email: raw.referredEmail,
    });
    if (!referrer.id && !referrer.plexId && !referred.id && !referred.plexId) return null;

    const entry = {
        id: asTrimmed(raw.id, 80) || makeId(),
        createdAt: asIso(raw.createdAt) || new Date().toISOString(),
        status,
        referrer,
        referred,
        referralCode: asTrimmed(raw.referralCode, 120),
        trialDays: asDays(raw.trialDays, 0),
        rewardDays: asDays(raw.rewardDays, 0),
        rewardApplied: raw.rewardApplied !== false && status === 'granted' && asDays(raw.rewardDays, 0) > 0,
        previousExpiryDate: asIso(raw.previousExpiryDate),
        newExpiryDate: asIso(raw.newExpiryDate),
    };
    const blockReason = asTrimmed(raw.blockReason, 80);
    if (status === 'blocked' && blockReason) entry.blockReason = blockReason;
    return entry;
};

export const normalizeReferralRewardsDocument = (raw, existing = emptyReferralRewardsDocument()) => {
    const source = Array.isArray(raw?.rewards)
        ? raw.rewards
        : (Array.isArray(raw) ? raw : (Array.isArray(existing?.rewards) ? existing.rewards : []));
    const seen = new Set();
    const rewards = [];
    for (const item of source) {
        const entry = normalizeReferralReward(item);
        if (!entry || seen.has(entry.id)) continue;
        seen.add(entry.id);
        rewards.push(entry);
        if (rewards.length >= MAX_REFERRAL_REWARDS) break;
    }
    return { rewards };
};

const idsForUser = (user = {}) => {
    const out = new Set();
    for (const value of [user.id, user.plexId, user.jellyfinId, user.embyId]) {
        const id = asTrimmed(value, 120);
        if (id) out.add(id);
    }
    return out;
};

export const sameAccount = (a, b) => {
    const left = idsForUser(a);
    const right = idsForUser(b);
    if (left.size === 0 || right.size === 0) return false;
    for (const id of left) {
        if (right.has(id)) return true;
    }
    return false;
};

export const findGrantedRewardForReferred = (doc, referredUser) => {
    const rewards = normalizeReferralRewardsDocument(doc).rewards;
    return rewards.find((entry) => entry.status === 'granted' && sameAccount(entry.referred, referredUser)) || null;
};

export const summarizeReferrerRewards = (doc, referrerUser) => {
    const rewards = normalizeReferralRewardsDocument(doc).rewards
        .filter((entry) => entry.status === 'granted' && sameAccount(entry.referrer, referrerUser));
    const totalBonusDays = rewards.reduce((sum, entry) => sum + (entry.rewardApplied ? entry.rewardDays : 0), 0);
    return {
        successfulReferrals: rewards.length,
        totalBonusDays,
        recent: rewards.slice(0, 10),
    };
};

export const createReferralRewardEntry = ({
    status = 'granted',
    blockReason = null,
    referrer,
    referred,
    referralCode,
    trialDays = 0,
    rewardDays = 0,
    rewardApplied = true,
    previousExpiryDate = null,
    newExpiryDate = null,
    createdAt = null,
} = {}) => normalizeReferralReward({
    id: makeId(),
    createdAt: createdAt || new Date().toISOString(),
    status,
    blockReason,
    referrer,
    referred,
    referralCode,
    trialDays,
    rewardDays,
    rewardApplied,
    previousExpiryDate,
    newExpiryDate,
});

export const prependReferralReward = (doc, entry) => {
    const normalized = normalizeReferralRewardsDocument(doc);
    const reward = normalizeReferralReward(entry);
    if (!reward) return normalized;
    return {
        rewards: [reward, ...normalized.rewards].slice(0, MAX_REFERRAL_REWARDS),
    };
};
