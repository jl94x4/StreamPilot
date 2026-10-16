export const MAX_INVITE_PROFILES = 50;
export const MAX_INVITE_PROFILE_NAME = 80;
export const MAX_INVITE_PROFILE_NOTE = 2000;

const makeId = () => (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `invite-profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
);

const normalizeMaxUses = (value) => {
    if (value === 'unlimited' || String(value || '').trim().toLowerCase() === 'unlimited') {
        return 'unlimited';
    }
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(parsed, 100000);
};

const normalizeDurationDays = (value) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 30;
    return Math.min(parsed, 36500);
};

const normalizeLibraryIds = (value) => {
    if (!Array.isArray(value) || value.length === 0) return null;
    const ids = [];
    const seen = new Set();
    for (const raw of value) {
        const id = String(raw ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= 200) break;
    }
    return ids.length > 0 ? ids : null;
};

const normalizeEmailNote = (value) => {
    const note = String(value || '').trim();
    if (!note) return undefined;
    return note.slice(0, MAX_INVITE_PROFILE_NOTE);
};

/**
 * Normalize a persisted invite-profiles document.
 * Shape: { profiles: InviteProfile[], defaultProfileId: string | null }
 */
export const normalizeInviteProfilesDocument = (raw, existing = { profiles: [], defaultProfileId: null }) => {
    const sourceProfiles = Array.isArray(raw?.profiles)
        ? raw.profiles
        : (Array.isArray(raw) ? raw : (Array.isArray(existing?.profiles) ? existing.profiles : []));
    const seen = new Set();
    const profiles = [];

    for (const entry of sourceProfiles) {
        if (!entry || typeof entry !== 'object') continue;
        const id = String(entry.id || '').trim() || makeId();
        if (seen.has(id)) continue;
        const name = String(entry.name || '').trim().slice(0, MAX_INVITE_PROFILE_NAME);
        if (!name) continue;
        seen.add(id);
        profiles.push({
            id,
            name,
            durationDays: normalizeDurationDays(entry.durationDays),
            maxUses: normalizeMaxUses(entry.maxUses),
            libraryIds: normalizeLibraryIds(entry.libraryIds),
            emailNote: normalizeEmailNote(entry.emailNote),
        });
        if (profiles.length >= MAX_INVITE_PROFILES) break;
    }

    const requestedDefault = String(
        raw?.defaultProfileId
        ?? existing?.defaultProfileId
        ?? ''
    ).trim();
    const defaultProfileId = profiles.some((p) => p.id === requestedDefault)
        ? requestedDefault
        : null;

    return { profiles, defaultProfileId };
};

export const createInviteProfile = (input = {}) => {
    const doc = normalizeInviteProfilesDocument({
        profiles: [{ ...input, id: input.id || makeId() }],
        defaultProfileId: null,
    });
    return doc.profiles[0] || null;
};

export const emptyInviteProfilesDocument = () => ({ profiles: [], defaultProfileId: null });
