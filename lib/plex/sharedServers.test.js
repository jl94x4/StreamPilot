import assert from 'node:assert/strict';
import test from 'node:test';
import {
    matchPlexSharedServerForSession,
    normalizePlexSharedServer,
    parsePlexSharedServers,
    parsePlexSharedServersXml,
    parsePlexUsersServerTokensXml,
    resolvePlexSharedServerMemberToken,
} from './sharedServers.js';

test('parsePlexSharedServersXml reads friend tokens', () => {
    const shares = parsePlexSharedServersXml(`
        <MediaContainer>
          <SharedServer id="10" userID="222" username="vik" email="vik@x.com" accessToken="vik-server-token"/>
          <SharedServer id="11" userID="333" username="sam" accessToken="sam-token"/>
        </MediaContainer>
    `);
    assert.equal(shares.length, 2);
    assert.equal(shares[0].userID, '222');
    assert.equal(shares[0].accessToken, 'vik-server-token');
});

test('parsePlexSharedServers reads JSON SharedServer list', () => {
    const shares = parsePlexSharedServers({
        MediaContainer: {
            SharedServer: [
                { userID: 222, username: 'vik', accessToken: 'tok' },
            ],
        },
    });
    assert.equal(shares[0].userID, '222');
    assert.equal(shares[0].accessToken, 'tok');
});

test('matchPlexSharedServerForSession prefers plex.tv user id', () => {
    const shares = [
        normalizePlexSharedServer({ userID: '111', username: 'admin', accessToken: 'a' }),
        normalizePlexSharedServer({ userID: '222', username: 'vik', email: 'vik@x.com', accessToken: 'vik-token' }),
    ];
    assert.equal(matchPlexSharedServerForSession(shares, { plexId: '222' })?.accessToken, 'vik-token');
    assert.equal(matchPlexSharedServerForSession(shares, { username: 'vik' })?.userID, '222');
    assert.equal(matchPlexSharedServerForSession(shares, { id: 'vik-uuid' }, { uuid: 'vik-uuid', plexId: '222' })?.accessToken, 'vik-token');
    assert.equal(matchPlexSharedServerForSession(shares, { plexId: 'missing' }), null);
});

test('parsePlexUsersServerTokensXml reads Home user server tokens', () => {
    const shares = parsePlexUsersServerTokensXml(`
        <MediaContainer>
          <User id="22" uuid="kids-uuid" title="Kids" username="Kids" home="1">
            <Server machineIdentifier="machine-1" name="Living Room" accessToken="kids-server-token"/>
          </User>
          <User id="99" title="Other">
            <Server machineIdentifier="other-machine" accessToken="nope"/>
          </User>
        </MediaContainer>
    `, 'machine-1');
    assert.equal(shares.length, 1);
    assert.equal(shares[0].userID, '22');
    assert.equal(shares[0].accessToken, 'kids-server-token');
});

test('resolvePlexSharedServerMemberToken returns the friend server token', async () => {
    const cache = new Map();
    const result = await resolvePlexSharedServerMemberToken({
        ownerToken: 'owner-token',
        machineId: 'machine-1',
        sessionUser: { id: 'member-1', plexId: '222', username: 'vik' },
        cache,
        fetchShares: async () => [
            { userID: '222', username: 'vik', accessToken: 'vik-server-token' },
        ],
    });
    assert.equal(result, 'vik-server-token');
    assert.equal(cache.get('member-1').token, 'vik-server-token');
});

test('resolvePlexSharedServerMemberToken ignores the owner token', async () => {
    const result = await resolvePlexSharedServerMemberToken({
        ownerToken: 'owner-token',
        machineId: 'machine-1',
        sessionUser: { plexId: '222' },
        fetchShares: async () => [
            { userID: '222', username: 'vik', accessToken: 'owner-token' },
        ],
    });
    assert.equal(result, '');
});
