import { createHash } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Session tokens are 7-day JWTs. This makes them revocable:
 * - one token (logout): its hash is denied until it would have expired anyway;
 * - every token of an account (sign out everywhere, user deleted / revoked): tokens issued
 *   before that moment are denied.
 * Checks are synchronous and in memory; changes are written to one small JSON file.
 */

const TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
// An account entry only matters while tokens issued before it can still be alive.
const ACCOUNT_ENTRY_TTL_MS = TOKEN_LIFETIME_MS + 24 * 60 * 60 * 1000;

const hashToken = (token) => createHash('sha256').update(String(token || '')).digest('hex');

const norm = (value) => String(value ?? '').trim().toLowerCase();

/** Every identity a session (or a stored user) can be known by. */
export const sessionAccountKeys = (identity) => {
    const keys = new Set();
    const add = (prefix, value) => {
        const v = norm(value);
        if (v) keys.add(`${prefix}:${v}`);
    };
    add('plex', identity?.plexId);
    add('plex', identity?.plexAccountId);
    add('jellyfin', identity?.jellyfinId);
    add('id', identity?.id);
    const id = norm(identity?.id);
    if (id.startsWith('jellyfin:')) add('jellyfin', id.slice('jellyfin:'.length));
    if (/^\d+$/.test(id)) add('plex', id);
    return [...keys];
};

export const createSessionRevocationStore = ({ filePath, now = () => Date.now(), log = () => undefined } = {}) => {
    let state = { tokens: {}, accounts: {} };
    if (filePath) {
        try {
            const raw = JSON.parse(readFileSync(filePath, 'utf8'));
            state = {
                tokens: raw?.tokens && typeof raw.tokens === 'object' ? raw.tokens : {},
                accounts: raw?.accounts && typeof raw.accounts === 'object' ? raw.accounts : {},
            };
        } catch {
            // missing or unreadable: nothing revoked yet
        }
    }

    const prune = () => {
        const at = now();
        for (const [hash, expiresAt] of Object.entries(state.tokens)) {
            if (Number(expiresAt) <= at) delete state.tokens[hash];
        }
        for (const [key, revokedAt] of Object.entries(state.accounts)) {
            if (Number(revokedAt) + ACCOUNT_ENTRY_TTL_MS <= at) delete state.accounts[key];
        }
    };

    const persist = () => {
        prune();
        if (!filePath) return;
        try {
            mkdirSync(path.dirname(filePath), { recursive: true });
            const tmp = `${filePath}.tmp`;
            writeFileSync(tmp, JSON.stringify(state));
            renameSync(tmp, filePath);
        } catch (error) {
            log(`Session revocations could not be saved: ${error.message}`);
        }
    };

    return {
        /** Logout: deny this one token until its own expiry. */
        revokeToken(token, decoded) {
            if (!token) return;
            const exp = Number(decoded?.exp) > 0 ? Number(decoded.exp) * 1000 : now() + TOKEN_LIFETIME_MS;
            if (exp <= now()) return;
            state.tokens[hashToken(token)] = exp;
            persist();
        },

        /** Sign out everywhere / account removed: deny every token issued before now. */
        revokeAccount(identity) {
            const keys = sessionAccountKeys(identity);
            if (!keys.length) return;
            const at = now();
            for (const key of keys) state.accounts[key] = at;
            persist();
        },

        /** True when a verified token must no longer be accepted. */
        isRevoked(token, decoded) {
            if (token && state.tokens[hashToken(token)]) return true;
            const issuedAtMs = Number(decoded?.iat) * 1000;
            if (!Number.isFinite(issuedAtMs)) return false;
            // The person actually signed in: the admin while impersonating, not the member.
            const identity = decoded?.actor && decoded?.impersonatingUserId ? decoded.actor : decoded;
            for (const key of sessionAccountKeys(identity)) {
                const revokedAt = Number(state.accounts[key]);
                // iat has one-second resolution: a login in the same second as the revocation stays valid.
                if (revokedAt && issuedAtMs < Math.floor(revokedAt / 1000) * 1000) return true;
            }
            return false;
        },
    };
};
