import assert from 'node:assert/strict';
import test from 'node:test';
import { findRequesterUser } from './findRequesterUser.js';

test('findRequesterUser maps a Seerr numeric id via email or plexId', () => {
    const users = [
        { id: 'portal-9', email: 'jay@example.com', username: 'ItsThatJk', plexId: '55' },
    ];
    assert.equal(findRequesterUser(users, {
        userId: 12,
        meta: { requestedByEmail: 'jay@example.com' },
    })?.id, 'portal-9');
    assert.equal(findRequesterUser(users, {
        userId: 12,
        meta: { requestedByPlexId: 55 },
    })?.id, 'portal-9');
});
