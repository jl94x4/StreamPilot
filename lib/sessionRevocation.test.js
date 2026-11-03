import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createSessionRevocationStore, sessionAccountKeys } from './sessionRevocation.js';

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
const iat = (ms) => Math.floor(ms / 1000);

test('logout denies only that token', () => {
    const store = createSessionRevocationStore({ now: () => T0 });
    const decoded = { plexId: 7, iat: iat(T0 - 1000), exp: iat(T0 + 60_000) };
    store.revokeToken('token-a', decoded);
    assert.equal(store.isRevoked('token-a', decoded), true);
    assert.equal(store.isRevoked('token-b', decoded), false);
});

test('sign out everywhere denies older tokens, not newer logins', () => {
    let now = T0;
    const store = createSessionRevocationStore({ now: () => now });
    store.revokeAccount({ id: 'uuid-1', plexId: 7 });
    assert.equal(store.isRevoked('old', { plexId: 7, iat: iat(T0 - 5000) }), true);
    assert.equal(store.isRevoked('old', { id: 'uuid-1', iat: iat(T0 - 5000) }), true);
    now = T0 + 2000;
    assert.equal(store.isRevoked('new', { plexId: 7, iat: iat(now) }), false);
    assert.equal(store.isRevoked('other', { plexId: 8, iat: iat(T0 - 5000) }), false);
});

test('impersonation is judged by the admin who signed in', () => {
    const store = createSessionRevocationStore({ now: () => T0 });
    store.revokeAccount({ plexId: 7 });
    const impersonating = { plexId: 7, impersonatingUserId: 'u7', actor: { plexId: 1 }, iat: iat(T0 - 5000) };
    assert.equal(store.isRevoked('t', impersonating), false);
});

test('jellyfin ids match however the session spells them', () => {
    assert.ok(sessionAccountKeys({ id: 'jellyfin:abc' }).includes('jellyfin:abc'));
    const store = createSessionRevocationStore({ now: () => T0 });
    store.revokeAccount({ jellyfinId: 'ABC' });
    assert.equal(store.isRevoked('t', { id: 'jellyfin:abc', iat: iat(T0 - 5000) }), true);
});

test('revocations survive a restart and expire', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sessrev-'));
    try {
        const filePath = path.join(dir, 'session-revocations.json');
        const first = createSessionRevocationStore({ filePath, now: () => T0 });
        first.revokeToken('tok', { exp: iat(T0 + 60_000) });
        first.revokeAccount({ plexId: 9 });
        const second = createSessionRevocationStore({ filePath, now: () => T0 });
        assert.equal(second.isRevoked('tok', {}), true);
        assert.equal(second.isRevoked('x', { plexId: 9, iat: iat(T0 - 5000) }), true);
        const later = createSessionRevocationStore({ filePath, now: () => T0 + 10 * 24 * 60 * 60 * 1000 });
        later.revokeAccount({ plexId: 1 }); // a write prunes old entries
        const reloaded = createSessionRevocationStore({ filePath, now: () => T0 + 10 * 24 * 60 * 60 * 1000 });
        assert.equal(reloaded.isRevoked('tok', {}), false);
        assert.equal(reloaded.isRevoked('x', { plexId: 9, iat: iat(T0 - 5000) }), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
