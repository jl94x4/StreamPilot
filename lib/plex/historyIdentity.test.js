import assert from 'node:assert/strict';
import test from 'node:test';
import { accountsMapFromResponse, devicesMapFromResponse, resolveHistoryRowIdentity } from './historyIdentity.js';

const accounts = accountsMapFromResponse({
    MediaContainer: { Account: [{ id: 1, name: 'Owner', thumb: 'https://plex.tv/o.png' }, { id: 2, name: 'Friend' }] },
});
const devices = devicesMapFromResponse({
    MediaContainer: { Device: [{ id: 7, name: 'Living room', platform: 'Android', product: 'StreamPilot' }] },
});

test('a history row that only has an account number gets that account\'s name and picture', () => {
    const who = resolveHistoryRowIdentity({ accountID: 1, deviceID: 7 }, { accounts, devices });
    assert.equal(who.user, 'Owner');
    assert.equal(who.userThumb, 'https://plex.tv/o.png');
    assert.equal(who.player, 'Living room');
    assert.equal(who.platform, 'Android');
    assert.equal(who.product, 'StreamPilot');
});

test('the portal user list is preferred over the server account list', () => {
    const who = resolveHistoryRowIdentity({ accountID: 2 }, { accounts, portalUsers: [{ id: '2', username: 'Fred', thumb: 'f.png' }] });
    assert.equal(who.user, 'Fred');
    assert.equal(who.userThumb, 'f.png');
});

test('a user object on the row wins, as live sessions have', () => {
    const who = resolveHistoryRowIdentity({ accountID: 1, User: { title: 'Named' }, Player: { title: 'TV' } }, { accounts, devices });
    assert.equal(who.user, 'Named');
    assert.equal(who.player, 'TV');
});

test('an account the server does not list is shown by number, and none at all as Unknown', () => {
    assert.equal(resolveHistoryRowIdentity({ accountID: 99 }, { accounts }).user, 'User 99');
    assert.equal(resolveHistoryRowIdentity({ accountID: 0 }, { accounts }).user, 'Unknown User');
    assert.equal(resolveHistoryRowIdentity({}, {}).user, 'Unknown User');
});
