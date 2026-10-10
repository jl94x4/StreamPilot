import assert from 'node:assert/strict';
import test from 'node:test';
import {
    extractSwitchAuthToken,
    findRememberedPlexHomeUser,
    isSamePlexHomeUser,
    matchPlexHomeUserForSession,
    resolvePlexHomeMemberToken,
    sessionCanUsePlexHomeSwitch,
    sessionIsPlexHomeProfile,
    shareTokenForHomeUser,
    normalizePlexHomeUser,
    parsePlexHomeUsers,
    parsePlexHomeUsersXml,
    shouldOfferPlexHomeSelect,
    switchPlexHomeUser,
    toPublicPlexHomeUser,
} from './homeUsers.js';

test('normalizePlexHomeUser keeps uuid-only profiles', () => {
    const user = normalizePlexHomeUser({ uuid: 'abc-uuid', title: 'Kids', protected: '1' });
    assert.equal(user?.id, 'abc-uuid');
    assert.equal(user?.protected, true);
});

test('parsePlexHomeUsers reads v2 users array', () => {
    const users = parsePlexHomeUsers({
        users: [
            { id: 1, title: 'Dad', uuid: 'aaa', admin: true, protected: true, thumb: 'https://plex.tv/a.png' },
            { id: 2, title: 'Kid', restricted: true, protected: '1' },
        ],
    });
    assert.equal(users.length, 2);
    assert.equal(users[0].title, 'Dad');
    assert.equal(users[0].admin, true);
    assert.equal(users[1].restricted, true);
    assert.equal(users[1].protected, true);
});

test('a plex.tv password is not a Home PIN', () => {
    const user = normalizePlexHomeUser({
        id: 1,
        title: 'Administration',
        admin: true,
        protected: 0,
        hasPassword: true,
    });
    assert.equal(user.protected, false);
    assert.equal(toPublicPlexHomeUser(user).protected, false);
});

test('parsePlexHomeUsersXml reads User tags', () => {
    const users = parsePlexHomeUsersXml(`
        <MediaContainer>
          <User id="11" uuid="u1" title="Owner" username="owner" admin="1" restricted="0"/>
          <User id="22" title="Family" restricted="1" protected="1"/>
        </MediaContainer>
    `);
    assert.equal(users.length, 2);
    assert.equal(users[1].id, '22');
    assert.equal(users[1].protected, true);
});

test('shouldOfferPlexHomeSelect only when multiple profiles exist', () => {
    assert.equal(shouldOfferPlexHomeSelect([{ id: '1' }]), false);
    assert.equal(shouldOfferPlexHomeSelect([{ id: '1' }, { id: '2' }]), true);
});

test('toPublicPlexHomeUser strips emails', () => {
    const pub = toPublicPlexHomeUser(normalizePlexHomeUser({
        id: 9,
        title: 'Kid',
        email: 'secret@example.com',
        restricted: true,
    }));
    assert.equal(pub.email, undefined);
    assert.equal(pub.title, 'Kid');
});

test('extractSwitchAuthToken reads JSON and XML', () => {
    assert.equal(extractSwitchAuthToken({ authenticationToken: 'tok-json' }), 'tok-json');
    assert.equal(
        extractSwitchAuthToken(null, '<user authenticationToken="tok-xml" title="Kid"/>'),
        'tok-xml',
    );
});

test('isSamePlexHomeUser matches id or uuid', () => {
    const user = { id: '10', uuid: 'abc' };
    assert.equal(isSamePlexHomeUser(user, '10'), true);
    assert.equal(isSamePlexHomeUser(user, 'abc'), true);
    assert.equal(isSamePlexHomeUser(user, '99'), false);
});

test('findRememberedPlexHomeUser returns the matching profile', () => {
    const users = [{ id: '1', title: 'Dad' }, { id: '22', uuid: 'kid', title: 'Kid' }];
    assert.equal(findRememberedPlexHomeUser(users, '22')?.title, 'Kid');
    assert.equal(findRememberedPlexHomeUser(users, 'kid')?.id, '22');
    assert.equal(findRememberedPlexHomeUser(users, 'missing'), null);
});

test('sessionCanUsePlexHomeSwitch allows owner cookie or home-user flag', () => {
    assert.equal(sessionCanUsePlexHomeSwitch({ isAdmin: true }), true);
    assert.equal(sessionCanUsePlexHomeSwitch({ plexHomeUser: true }), true);
    assert.equal(sessionCanUsePlexHomeSwitch({ hasOwnerToken: true }), true);
    assert.equal(sessionCanUsePlexHomeSwitch({}), false);
});

test('sessionIsPlexHomeProfile matches jwt plexId or uuid', () => {
    const users = [{ id: '22', uuid: 'lily-uuid', title: 'Lily' }];
    assert.equal(sessionIsPlexHomeProfile(users, { plexId: '22' }), true);
    assert.equal(sessionIsPlexHomeProfile(users, { id: 'lily-uuid' }), true);
    assert.equal(sessionIsPlexHomeProfile(users, { plexId: '99' }), false);
});

test('matchPlexHomeUserForSession prefers plex id then a unique name', () => {
    const users = [
        { id: '1', title: 'Dad', username: 'dad', admin: true },
        { id: '22', uuid: 'vik-uuid', title: 'Vik', username: 'vik' },
    ];
    assert.equal(matchPlexHomeUserForSession(users, { plexId: '22' })?.title, 'Vik');
    assert.equal(matchPlexHomeUserForSession(users, { username: 'Vik' }, {})?.id, '22');
    assert.equal(matchPlexHomeUserForSession(users, { username: 'Dad' })?.admin, undefined);
    assert.equal(matchPlexHomeUserForSession(users, { plexId: 'missing' }), null);
});

test('resolvePlexHomeMemberToken switches an unprotected Home profile', async () => {
    const cache = new Map();
    const result = await resolvePlexHomeMemberToken({
        ownerToken: 'owner-token',
        sessionUser: { id: 'member-1', plexId: '22', username: 'Vik' },
        cache,
        fetchHomeUsers: async () => [
            { id: '1', title: 'Dad', admin: true },
            { id: '22', title: 'Vik' },
        ],
        switchUser: async ({ userId }) => {
            assert.equal(userId, '22');
            return { ok: true, needsPin: false, authToken: 'vik-token' };
        },
    });
    assert.equal(result, 'vik-token');
    assert.equal(cache.get('member-1').token, 'vik-token');
});

test('resolvePlexHomeMemberToken skips PIN-protected profiles without a server token', async () => {
    const result = await resolvePlexHomeMemberToken({
        ownerToken: 'owner-token',
        machineId: 'machine-1',
        sessionUser: { plexId: '22', username: 'Vik' },
        fetchHomeUsers: async () => [{ id: '22', title: 'Vik' }],
        switchUser: async () => ({ ok: false, needsPin: true, authToken: '' }),
        fetchShares: async () => [],
    });
    assert.equal(result, '');
});

test('resolvePlexHomeMemberToken uses the Home profile shared-server token when switch needs a PIN', async () => {
    const result = await resolvePlexHomeMemberToken({
        ownerToken: 'owner-token',
        machineId: 'machine-1',
        sessionUser: { plexId: '22', username: 'Kids' },
        fetchHomeUsers: async () => [{ id: '22', uuid: 'kids-uuid', title: 'Kids' }],
        switchUser: async () => ({ ok: false, needsPin: true, authToken: '' }),
        fetchShares: async () => [
            { userID: '22', username: 'Kids', accessToken: 'kids-server-token' },
        ],
    });
    assert.equal(result, 'kids-server-token');
});

test('shareTokenForHomeUser matches the Home profile id', () => {
    assert.equal(shareTokenForHomeUser([
        { userID: '22', accessToken: 'kids-server-token' },
    ], { id: '22', uuid: 'kids-uuid' }), 'kids-server-token');
});

test('switchPlexHomeUser posts PIN and returns token', async () => {
    const calls = [];
    const result = await switchPlexHomeUser({
        token: 'owner-token',
        userId: '22',
        pin: '1234',
        headers: { Accept: 'application/json' },
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ authToken: 'switched-token' }),
            };
        },
    });
    assert.equal(result.ok, true);
    assert.equal(result.authToken, 'switched-token');
    assert.match(calls[0].url, /\/home\/users\/22\/switch\?pin=1234$/);
});

test('switchPlexHomeUser flags PIN required on 401', async () => {
    const result = await switchPlexHomeUser({
        token: 'owner-token',
        userId: '22',
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            text: async () => '',
        }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.needsPin, true);
});
