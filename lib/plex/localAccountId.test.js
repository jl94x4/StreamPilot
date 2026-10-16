import assert from 'node:assert/strict';
import test from 'node:test';
import {
    PLEX_OWNER_LOCAL_ACCOUNT_ID,
    isPlexCloudOwnerIdentity,
    isPlexServerOwnerUser,
    isTautulliAdminUser,
    resolveLocalPlexAccountIdFromParts,
    shortcutPortalPlexAccountId,
    shouldSkipTautulliAdminUser,
    usableStoredPlexAccountId,
} from './localAccountId.js';

const ADMIN_CLOUD = '999999';
const accounts = [
    { id: '1', name: 'BHD', email: 'owner@x.com' },
    { id: '42', name: '_iDrink', email: 'idrink@x.com' },
];

test('leftover isAdmin does not make a member the Plex owner', () => {
    assert.equal(isPlexServerOwnerUser({
        id: 'u1',
        plexId: '222',
        isAdmin: true,
        username: '_iDrink',
    }, { adminPlexId: ADMIN_CLOUD }), false);
    assert.equal(isPlexServerOwnerUser({
        id: ADMIN_CLOUD,
        plexId: ADMIN_CLOUD,
        isAdmin: true,
    }, { adminPlexId: ADMIN_CLOUD }), true);
    assert.equal(isPlexServerOwnerUser({
        isAdmin: true,
    }, { adminPlexId: ADMIN_CLOUD }), true);
});

test('isPlexCloudOwnerIdentity ignores isAdmin and impersonation', () => {
    assert.equal(isPlexCloudOwnerIdentity({
        sessionUser: { isAdmin: true, plexId: '222' },
        portalUser: { isAdmin: true, plexId: '222' },
        adminCloudId: ADMIN_CLOUD,
    }), false);
    assert.equal(isPlexCloudOwnerIdentity({
        sessionUser: { plexId: ADMIN_CLOUD, isAdmin: false },
        adminCloudId: ADMIN_CLOUD,
    }), true);
    assert.equal(isPlexCloudOwnerIdentity({
        sessionUser: { plexId: ADMIN_CLOUD },
        adminCloudId: ADMIN_CLOUD,
        impersonating: true,
    }), false);
});

test('members never keep stored owner account 1', () => {
    assert.equal(usableStoredPlexAccountId('1', { isOwner: false, adminCloudId: ADMIN_CLOUD }), null);
    assert.equal(usableStoredPlexAccountId(ADMIN_CLOUD, { isOwner: false, adminCloudId: ADMIN_CLOUD }), null);
    assert.equal(usableStoredPlexAccountId('42', { isOwner: false, adminCloudId: ADMIN_CLOUD }), '42');
    assert.equal(usableStoredPlexAccountId('1', { isOwner: true, adminCloudId: ADMIN_CLOUD }), '1');
});

test('wrap-up does not give owner history to a member with isAdmin or plexAccountId 1', () => {
    const member = { username: '_iDrink', email: 'idrink@x.com', plexId: '222', isAdmin: true };
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: false,
        storedAccountId: '1',
        adminCloudId: ADMIN_CLOUD,
        accounts,
        sessionUser: member,
    }), '42');
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: false,
        storedAccountId: ADMIN_CLOUD,
        adminCloudId: ADMIN_CLOUD,
        accounts,
        sessionUser: member,
    }), '42');
});

test('title can resolve a member local account when username is missing', () => {
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: false,
        storedAccountId: null,
        adminCloudId: ADMIN_CLOUD,
        accounts,
        sessionUser: { title: '_iDrink', plexId: '222' },
    }), '42');
});

test('username collision with the owner does not map a member to account 1', () => {
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: false,
        storedAccountId: null,
        adminCloudId: ADMIN_CLOUD,
        accounts,
        sessionUser: { username: 'BHD', plexId: '222' },
    }), null);
});

test('real owner still resolves to local account 1', () => {
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: true,
        storedAccountId: null,
        adminCloudId: ADMIN_CLOUD,
        accounts,
        sessionUser: { username: 'BHD', plexId: ADMIN_CLOUD },
    }), PLEX_OWNER_LOCAL_ACCOUNT_ID);
});

test('empty accounts do not fall back to a cloud plex.tv id for members', () => {
    assert.equal(resolveLocalPlexAccountIdFromParts({
        isOwner: false,
        storedAccountId: null,
        adminCloudId: ADMIN_CLOUD,
        accounts: [],
        sessionUser: { username: '_iDrink', plexId: '222' },
    }), null);
});

test('shortcutPortalPlexAccountId rejects poisoned stored ids for members', () => {
    assert.equal(shortcutPortalPlexAccountId({
        sessionUser: { plexId: '222' },
        portalUser: { plexId: '222', plexAccountId: '1' },
        adminCloudId: ADMIN_CLOUD,
    }), null);
    assert.equal(shortcutPortalPlexAccountId({
        sessionUser: { plexId: '222' },
        portalUser: { plexId: '222', plexAccountId: '42' },
        adminCloudId: ADMIN_CLOUD,
    }), '42');
    assert.equal(shortcutPortalPlexAccountId({
        sessionUser: { plexId: ADMIN_CLOUD },
        portalUser: { plexId: ADMIN_CLOUD },
        adminCloudId: ADMIN_CLOUD,
    }), PLEX_OWNER_LOCAL_ACCOUNT_ID);
});

test('Tautulli admin users are skipped unless history is for the owner account', () => {
    assert.equal(isTautulliAdminUser({ is_admin: 1, user_id: 1, username: 'BHD' }), true);
    assert.equal(isTautulliAdminUser({ is_admin: 0, user_id: 8, username: '_iDrink' }), false);
    assert.equal(shouldSkipTautulliAdminUser('42'), true);
    assert.equal(shouldSkipTautulliAdminUser('1'), false);
});
