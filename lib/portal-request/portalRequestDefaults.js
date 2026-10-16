/**
 * Portal request discovery defaults (Seerr-parity globals + per-user overrides).
 * null / omitted on user.requestOverrides = inherit global.
 */

const normalizeRequestQuotaLimit = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(1000, Math.floor(n));
};

const normalizeRequestQuotaDays = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) return 7;
    return Math.min(365, Math.floor(n));
};

const triStateBool = (value) => {
    if (value === true || value === false) return value;
    return null;
};

export const normalizeMetadataProvider = (value) => {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'tvdb' ? 'tvdb' : 'tmdb';
};

/** Global portal request defaults from config.json */
export const getPortalRequestDefaults = (config = {}) => ({
    allowRequestMovies: config.portalAllowRequestMovies !== false,
    allowRequestTv: config.portalAllowRequestTv !== false,
    allowRequestMusic: config.portalAllowRequestMusic !== false,
    // Match HD defaults — when a 4K *arr exists, members can request UHD unless explicitly denied.
    allowRequest4kMovies: config.portalAllowRequest4kMovies !== false,
    allowRequest4kTv: config.portalAllowRequest4kTv !== false,
    allowAdvancedRequests: config.portalAllowAdvancedRequests !== false,
    allowRequestTags: config.portalAllowRequestTags !== false,
    showRecentlyAdded: config.portalShowRecentlyAdded !== false,
    showWatchlist: config.portalShowWatchlist !== false,
    autoApproveMovies: !!config.autoApproveMovies,
    autoApproveTv: !!config.autoApproveTv,
    autoApproveMovies4k: !!config.autoApproveMovies4k,
    autoApproveTv4k: !!config.autoApproveTv4k,
    autoRequestMovies: !!config.portalAutoRequestMovies,
    autoRequestTv: !!config.portalAutoRequestTv,
    movieQuotaLimit: normalizeRequestQuotaLimit(config.requestQuotaLimit),
    movieQuotaDays: normalizeRequestQuotaDays(config.requestQuotaDays),
    tvQuotaLimit: normalizeRequestQuotaLimit(
        config.requestQuotaLimitTv != null ? config.requestQuotaLimitTv : config.requestQuotaLimit,
    ),
    tvQuotaDays: normalizeRequestQuotaDays(
        config.requestQuotaDaysTv != null ? config.requestQuotaDaysTv : config.requestQuotaDays,
    ),
    fourKQuotaLimit: normalizeRequestQuotaLimit(
        config.requestQuotaLimit4k != null ? config.requestQuotaLimit4k : config.requestQuotaLimit,
    ),
    fourKQuotaDays: normalizeRequestQuotaDays(
        config.requestQuotaDays4k != null ? config.requestQuotaDays4k : config.requestQuotaDays,
    ),
    seriesMetadataProvider: normalizeMetadataProvider(config.seriesMetadataProvider),
    animeMetadataProvider: normalizeMetadataProvider(config.animeMetadataProvider),
    tvdbApiKey: String(config.tvdbApiKey || '').trim(),
});

/** Normalize a users.json requestOverrides blob (null fields = inherit). */
export const normalizeUserRequestOverrides = (raw = {}) => {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const intKeys = [
        'movieQuotaLimit', 'movieQuotaDays',
        'tvQuotaLimit', 'tvQuotaDays',
        'fourKQuotaLimit', 'fourKQuotaDays',
    ];
    for (const key of intKeys) {
        if (raw[key] == null || raw[key] === '') {
            out[key] = null;
            continue;
        }
        if (key.endsWith('Days')) out[key] = normalizeRequestQuotaDays(raw[key]);
        else out[key] = normalizeRequestQuotaLimit(raw[key]);
    }
    const boolKeys = [
        'allowRequestMovies', 'allowRequestTv', 'allowRequestMusic',
        'allowRequest4kMovies', 'allowRequest4kTv',
        'allowAdvancedRequests',
    ];
    for (const key of boolKeys) {
        out[key] = triStateBool(raw[key]);
    }
    return out;
};

/**
 * Effective policy for a member = globals overlaid with non-null user overrides.
 * @param {object} config
 * @param {object|null} user users.json entry (optional)
 */
export const resolveMemberRequestPolicy = (config = {}, user = null) => {
    const globals = getPortalRequestDefaults(config);
    const overrides = normalizeUserRequestOverrides(user?.requestOverrides || {});

    const pick = (key) => (
        overrides[key] !== null && overrides[key] !== undefined
            ? overrides[key]
            : globals[key]
    );

    return {
        ...globals,
        allowRequestMovies: pick('allowRequestMovies'),
        allowRequestTv: pick('allowRequestTv'),
        allowRequestMusic: pick('allowRequestMusic'),
        allowRequest4kMovies: pick('allowRequest4kMovies'),
        allowRequest4kTv: pick('allowRequest4kTv'),
        allowAdvancedRequests: pick('allowAdvancedRequests'),
        allowRequestTags: globals.allowRequestTags,
        movieQuotaLimit: pick('movieQuotaLimit'),
        movieQuotaDays: pick('movieQuotaDays'),
        tvQuotaLimit: pick('tvQuotaLimit'),
        tvQuotaDays: pick('tvQuotaDays'),
        fourKQuotaLimit: pick('fourKQuotaLimit'),
        fourKQuotaDays: pick('fourKQuotaDays'),
        // Keep globals for auto-approve / auto-request / UI gates (not per-user yet)
        autoApproveMovies: globals.autoApproveMovies,
        autoApproveTv: globals.autoApproveTv,
        autoApproveMovies4k: globals.autoApproveMovies4k,
        autoApproveTv4k: globals.autoApproveTv4k,
        autoRequestMovies: globals.autoRequestMovies,
        autoRequestTv: globals.autoRequestTv,
        showRecentlyAdded: globals.showRecentlyAdded,
        showWatchlist: globals.showWatchlist,
        seriesMetadataProvider: globals.seriesMetadataProvider,
        animeMetadataProvider: globals.animeMetadataProvider,
        overrides,
    };
};

export const canPolicyRequestMedia = (policy, mediaType, { is4k = false } = {}) => {
    const type = String(mediaType || '').toLowerCase();
    if (type === 'music') {
        if (!policy.allowRequestMusic) return { ok: false, reason: 'Music requests are disabled.' };
        return { ok: true, reason: null };
    }
    const normalized = type === 'tv' ? 'tv' : 'movie';
    if (normalized === 'tv') {
        if (!policy.allowRequestTv) return { ok: false, reason: 'Series requests are disabled.' };
        if (is4k && !policy.allowRequest4kTv) return { ok: false, reason: 'You do not have permission to request 4K series.' };
    } else {
        if (!policy.allowRequestMovies) return { ok: false, reason: 'Movie requests are disabled.' };
        if (is4k && !policy.allowRequest4kMovies) return { ok: false, reason: 'You do not have permission to request 4K movies.' };
    }
    return { ok: true, reason: null };
};

export const shouldPortalAutoApprove = (config, mediaType, { is4k = false } = {}) => {
    const defaults = getPortalRequestDefaults(config);
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    if (is4k) {
        return type === 'tv' ? defaults.autoApproveTv4k : defaults.autoApproveMovies4k;
    }
    return type === 'tv' ? defaults.autoApproveTv : defaults.autoApproveMovies;
};

/** Fields to persist on POST /api/config (normalize incoming body). */
export const pickPortalRequestDefaultsForSave = (body = {}, existingConfig = {}) => {
    const pickBool = (key, fallbackKey = key) => {
        if (body[key] !== undefined) return !!body[key];
        return !!existingConfig[fallbackKey];
    };
    const pickBoolDefaultTrue = (key) => {
        if (body[key] !== undefined) return !!body[key];
        return existingConfig[key] !== false;
    };

    return {
        portalAllowRequestMovies: pickBoolDefaultTrue('portalAllowRequestMovies'),
        portalAllowRequestTv: pickBoolDefaultTrue('portalAllowRequestTv'),
        portalAllowRequest4kMovies: pickBool('portalAllowRequest4kMovies'),
        portalAllowRequest4kTv: pickBool('portalAllowRequest4kTv'),
        portalAllowAdvancedRequests: pickBoolDefaultTrue('portalAllowAdvancedRequests'),
        portalAllowRequestTags: pickBoolDefaultTrue('portalAllowRequestTags'),
        portalShowRecentlyAdded: pickBoolDefaultTrue('portalShowRecentlyAdded'),
        portalShowWatchlist: pickBoolDefaultTrue('portalShowWatchlist'),
        autoApproveMovies4k: pickBool('autoApproveMovies4k'),
        autoApproveTv4k: pickBool('autoApproveTv4k'),
        portalAutoRequestMovies: pickBool('portalAutoRequestMovies'),
        portalAutoRequestTv: pickBool('portalAutoRequestTv'),
        seriesMetadataProvider: normalizeMetadataProvider(
            body.seriesMetadataProvider !== undefined
                ? body.seriesMetadataProvider
                : existingConfig.seriesMetadataProvider,
        ),
        animeMetadataProvider: normalizeMetadataProvider(
            body.animeMetadataProvider !== undefined
                ? body.animeMetadataProvider
                : existingConfig.animeMetadataProvider,
        ),
    };
};

/** Shape returned on GET /api/config settings blob. */
export const portalRequestDefaultsForClient = (config = {}, { secretMask = '********' } = {}) => {
    const defaults = getPortalRequestDefaults(config);
    return {
        portalAllowRequestMovies: defaults.allowRequestMovies,
        portalAllowRequestTv: defaults.allowRequestTv,
        portalAllowRequest4kMovies: defaults.allowRequest4kMovies,
        portalAllowRequest4kTv: defaults.allowRequest4kTv,
        portalAllowAdvancedRequests: defaults.allowAdvancedRequests,
        portalAllowRequestTags: defaults.allowRequestTags,
        portalShowRecentlyAdded: defaults.showRecentlyAdded,
        portalShowWatchlist: defaults.showWatchlist,
        autoApproveMovies4k: defaults.autoApproveMovies4k,
        autoApproveTv4k: defaults.autoApproveTv4k,
        portalAutoRequestMovies: defaults.autoRequestMovies,
        portalAutoRequestTv: defaults.autoRequestTv,
        seriesMetadataProvider: defaults.seriesMetadataProvider,
        animeMetadataProvider: defaults.animeMetadataProvider,
        tvdbApiKey: defaults.tvdbApiKey ? secretMask : '',
    };
};

export default {
    getPortalRequestDefaults,
    resolveMemberRequestPolicy,
    canPolicyRequestMedia,
    shouldPortalAutoApprove,
    normalizeUserRequestOverrides,
    pickPortalRequestDefaultsForSave,
    portalRequestDefaultsForClient,
    normalizeMetadataProvider,
};
