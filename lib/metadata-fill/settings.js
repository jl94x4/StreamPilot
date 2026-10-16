/**
 * Normalize Metadata Fill preferences from portal config.
 */

const asBool = (value, fallback = true) => {
    if (value === undefined || value === null) return fallback;
    return !!value;
};

export const normalizeMetadataFillFields = (raw = {}) => {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
        title: asBool(src.title, true),
        summary: asBool(src.summary, true),
        originallyAvailableAt: asBool(src.originallyAvailableAt, true),
    };
};

/** @returns {'tmdb'|'tvdb'|'auto'} */
export const normalizeMetadataFillSourcePreference = (value) => {
    const v = String(value || 'auto').trim().toLowerCase();
    if (v === 'tmdb' || v === 'tvdb') return v;
    return 'auto';
};

export const normalizeMetadataFillLibraryKeys = (value) => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((k) => String(k || '').replace(/\D/g, '')).filter(Boolean))];
};

/**
 * Resolved options used by fill jobs / scan / UI.
 */
export const getMetadataFillOptions = (config = {}) => ({
    fields: normalizeMetadataFillFields(config.metadataFillFields),
    sourcePreference: normalizeMetadataFillSourcePreference(config.metadataFillSourcePreference),
    requireTitleAgreement: config.metadataFillRequireTitleAgreement === true,
    libraryKeys: normalizeMetadataFillLibraryKeys(config.metadataFillLibraryKeys),
});

/**
 * Apply POST /settings body onto config (mutates and returns config).
 */
export const applyMetadataFillSettingsPatch = (config = {}, body = {}) => {
    if (body.enabled !== undefined) {
        config.metadataFillEnabled = !!body.enabled;
    }
    if (body.autoImport !== undefined) {
        config.metadataFillAutoImport = !!body.autoImport;
    }
    if (body.fields !== undefined) {
        config.metadataFillFields = normalizeMetadataFillFields(body.fields);
    }
    if (body.sourcePreference !== undefined) {
        config.metadataFillSourcePreference = normalizeMetadataFillSourcePreference(body.sourcePreference);
    }
    if (body.requireTitleAgreement !== undefined) {
        config.metadataFillRequireTitleAgreement = !!body.requireTitleAgreement;
    }
    if (body.libraryKeys !== undefined) {
        config.metadataFillLibraryKeys = normalizeMetadataFillLibraryKeys(body.libraryKeys);
    }
    return config;
};
