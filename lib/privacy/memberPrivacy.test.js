import assert from 'node:assert/strict';
import test from 'node:test';
import {
    adminAllowsMemberNames,
    applyMemberNamePrivacyToRows,
    applyStreamPrivacy,
    findPortalUserForStream,
    normalizeMemberPrivacy,
    privacyMaskNowPlayingOthers,
    shouldHidePeerName,
} from './memberPrivacy.js';

const jay = {
    id: 'share-1',
    plexId: '42',
    plexAccountId: '12',
    username: 'jay',
    privacyShowName: false,
    privacyShowPlayer: true,
    privacyShowAchievements: true,
};

test('adminAllowsMemberNames is true only when stream privacy is Show Names', () => {
    assert.equal(adminAllowsMemberNames({ hideStreamUsers: 'false' }), true);
    assert.equal(adminAllowsMemberNames({ hideStreamUsers: 'anonymous' }), false);
    assert.equal(adminAllowsMemberNames({ hideStreamUsers: 'hidden' }), false);
    assert.equal(adminAllowsMemberNames({ hideStreamUsers: true }), false);
});

test('normalizeMemberPrivacy defaults to visible', () => {
    assert.deepEqual(normalizeMemberPrivacy({}), {
        privacyShowName: true,
        privacyShowPlayer: true,
        privacyShowAchievements: true,
        privacyShowProfile: true,
    });
    assert.equal(normalizeMemberPrivacy({ privacyShowName: false }).privacyShowName, false);
});

test('findPortalUserForStream matches plex id and username', () => {
    const users = [jay, { id: 'other', username: 'sam' }];
    assert.equal(findPortalUserForStream(users, { plexUserId: '12' })?.username, 'jay');
    assert.equal(findPortalUserForStream(users, { user: 'Jay' })?.username, 'jay');
    assert.equal(findPortalUserForStream(users, { user: 'Unknown User' }), null);
});

test('applyStreamPrivacy: admin global hide still wins over member opt-in', () => {
    const identity = { user: 'jay', userThumb: 't', playerTitle: 'Shield', accountId: '12' };
    const hidden = applyStreamPrivacy({
        viewer: { isAdmin: false },
        config: { hideStreamUsers: 'hidden' },
        identity,
        subjectUser: { privacyShowName: true, privacyShowPlayer: true },
    });
    assert.equal(hidden.user, null);
    assert.equal(hidden.playerTitle, null);
    assert.equal(hidden.accountId, undefined);
});

test('applyStreamPrivacy: member can hide name while admin shows names', () => {
    const masked = applyStreamPrivacy({
        viewer: { isAdmin: false },
        config: { hideStreamUsers: 'false' },
        identity: { user: 'jay', userThumb: 't', playerTitle: 'Shield', accountId: '12' },
        subjectUser: jay,
    });
    assert.equal(masked.user, 'Anonymous');
    assert.equal(masked.userThumb, null);
    assert.equal(masked.playerTitle, 'Shield');
    assert.equal(masked.accountId, undefined);
});

test('applyStreamPrivacy: admins always see the real identity', () => {
    const identity = { user: 'jay', userThumb: 't', playerTitle: 'Shield' };
    const shown = applyStreamPrivacy({
        viewer: { isAdmin: true },
        config: { hideStreamUsers: 'false' },
        identity,
        subjectUser: jay,
    });
    assert.deepEqual(shown, identity);
});

test('shouldHidePeerName follows the member name opt-out', () => {
    assert.equal(shouldHidePeerName(jay), true);
    assert.equal(shouldHidePeerName(jay, { viewerIsAdmin: true }), false);
    assert.equal(shouldHidePeerName({ privacyShowName: true }), false);
});

test('applyMemberNamePrivacyToRows anonymizes opted-out peers only', () => {
    const rows = applyMemberNamePrivacyToRows(
        [
            { username: 'jay', accountId: '12', isMe: false },
            { username: 'sam', accountId: '9', isMe: false },
            { username: 'me', accountId: '1', isMe: true },
        ],
        [jay, { id: '9', username: 'sam', privacyShowName: true }],
        { obfuscate: false, viewerIsAdmin: false },
    );
    assert.equal(rows[0].username, 'Anonymous');
    assert.equal(rows[1].username, 'sam');
    assert.equal(rows[2].username, 'me');
});

test('privacyMaskNowPlayingOthers hides names and drops links when opted out', () => {
    const masked = privacyMaskNowPlayingOthers({
        others: [{ username: 'jay', accountId: '12', thumb: 't' }],
        users: [jay],
        viewer: { isAdmin: false },
        config: { hideStreamUsers: 'false' },
    });
    assert.equal(masked[0].username, 'Anonymous');
    assert.equal(masked[0].accountId, null);
});
