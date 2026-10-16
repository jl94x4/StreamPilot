import assert from 'node:assert/strict';
import {
    createInviteProfile,
    emptyInviteProfilesDocument,
    normalizeInviteProfilesDocument,
    MAX_INVITE_PROFILES,
} from './invite-profiles.js';

const empty = emptyInviteProfilesDocument();
assert.deepEqual(empty, { profiles: [], defaultProfileId: null });

const created = createInviteProfile({
    name: '  Trial - 7 Days  ',
    durationDays: 7,
    maxUses: 1,
    libraryIds: ['1', '2', '1', ''],
    emailNote: 'Welcome!',
});
assert.equal(created.name, 'Trial - 7 Days');
assert.equal(created.durationDays, 7);
assert.equal(created.maxUses, 1);
assert.deepEqual(created.libraryIds, ['1', '2']);
assert.equal(created.emailNote, 'Welcome!');
assert.ok(created.id);

const doc = normalizeInviteProfilesDocument({
    profiles: [
        created,
        { id: 'month', name: '1 Month', durationDays: 30, maxUses: 'unlimited', libraryIds: null },
        { id: 'bad', name: '   ' },
        { name: 'No id yet', durationDays: 0, maxUses: 0 },
        { id: created.id, name: 'Duplicate id ignored', durationDays: 90 },
    ],
    defaultProfileId: 'month',
});
assert.equal(doc.profiles.length, 3);
assert.equal(doc.defaultProfileId, 'month');
assert.equal(doc.profiles[1].maxUses, 'unlimited');
assert.equal(doc.profiles[1].libraryIds, null);
assert.equal(doc.profiles[2].durationDays, 30);
assert.equal(doc.profiles[2].maxUses, 1);

const clearedDefault = normalizeInviteProfilesDocument({
    profiles: doc.profiles,
    defaultProfileId: 'missing',
});
assert.equal(clearedDefault.defaultProfileId, null);

const many = normalizeInviteProfilesDocument({
    profiles: Array.from({ length: MAX_INVITE_PROFILES + 5 }, (_, i) => ({
        id: `p${i}`,
        name: `Profile ${i}`,
        durationDays: 30,
        maxUses: 1,
    })),
});
assert.equal(many.profiles.length, MAX_INVITE_PROFILES);

console.log('invite-profiles tests passed');
