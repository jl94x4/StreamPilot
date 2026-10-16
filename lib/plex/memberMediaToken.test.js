import assert from 'node:assert/strict';
import test from 'node:test';
import { preferPmsMemberToken } from './memberMediaToken.js';

test('preferPmsMemberToken picks shared-server tokens before account login tokens', () => {
    assert.equal(preferPmsMemberToken({
        sharedServerToken: 'shared-token',
        homeSwitchToken: 'home-token',
        accountToken: 'account-token',
        adminOwnerToken: 'owner-token',
    }), 'shared-token');
});

test('preferPmsMemberToken falls through Home then account then owner', () => {
    assert.equal(preferPmsMemberToken({
        homeSwitchToken: 'home-token',
        accountToken: 'account-token',
    }), 'home-token');
    assert.equal(preferPmsMemberToken({
        accountToken: 'account-token',
        adminOwnerToken: 'owner-token',
    }), 'account-token');
    assert.equal(preferPmsMemberToken({
        adminOwnerToken: 'owner-token',
    }), 'owner-token');
    assert.equal(preferPmsMemberToken({}), '');
});
