/**
 * Classify Plex clearlogo coverage for a movie/show.
 */

const asArray = (value) => {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
};

const normalizeProvider = (value) => String(value || '').trim().toLowerCase();

/** True when metadata Image[] already includes a selected clearLogo. */
export const hasSelectedClearLogoOnMeta = (metadata = {}) => {
    for (const row of asArray(metadata?.Image)) {
        const type = String(row?.type || '').toLowerCase();
        const alt = String(row?.alt || '').toLowerCase();
        if (type === 'clearlogo' || type === 'logo' || alt === 'clearlogo' || alt === 'logo') {
            const url = String(row?.url || row?.key || '').trim();
            if (url) return true;
        }
    }
    return false;
};

/**
 * Normalize a Photo/Logo row from GET .../clearLogos.
 * @returns {{ key: string, ratingKey: string, provider: string, selected: boolean, thumb: string }}
 */
export const normalizeClearLogoCandidate = (row = {}) => {
    const ratingKey = String(row?.ratingKey || row?.key || '').trim();
    const key = String(row?.key || ratingKey).trim();
    return {
        key,
        ratingKey,
        provider: String(row?.provider || '').trim(),
        selected: row?.selected === true || row?.selected === 1 || row?.selected === '1',
        thumb: String(row?.thumb || key || '').trim(),
    };
};

export const normalizeClearLogoList = (payload = {}) => {
    const rows = asArray(
        payload?.MediaContainer?.Metadata
        || payload?.MediaContainer?.Photo
        || payload?.MediaContainer?.Directory
        || payload?.MediaContainer?.Image
        || payload?.Metadata
        || payload?.Photo
        || [],
    );
    // Some PMS builds nest Photos under MediaContainer only as attributes + children —
    // also accept a bare array.
    const list = rows.length ? rows : (Array.isArray(payload) ? payload : []);
    return list
        .map(normalizeClearLogoCandidate)
        .filter((row) => row.ratingKey);
};

/**
 * Prefer agent-supplied logos over local/upload entries.
 */
export const pickBestClearLogoCandidate = (candidates = []) => {
    const rows = (Array.isArray(candidates) ? candidates : [])
        .map(normalizeClearLogoCandidate)
        .filter((row) => row.ratingKey && !row.selected);
    if (!rows.length) {
        const any = (Array.isArray(candidates) ? candidates : [])
            .map(normalizeClearLogoCandidate)
            .filter((row) => row.ratingKey);
        return any[0] || null;
    }
    const agent = rows.find((row) => {
        const provider = normalizeProvider(row.provider);
        if (!provider || provider === 'local' || provider === 'none') return false;
        if (provider.includes('upload')) return false;
        return true;
    });
    return agent || rows[0] || null;
};

/**
 * @param {{ metadata?: object, clearLogos?: object[]|object }} input
 * @returns {{ status: 'hasLogo'|'available'|'none', selected: object|null, candidates: object[], count: number }}
 */
export const classifyClearLogoCoverage = ({ metadata = null, clearLogos = [] } = {}) => {
    const candidates = Array.isArray(clearLogos)
        ? clearLogos.map(normalizeClearLogoCandidate).filter((row) => row.ratingKey)
        : normalizeClearLogoList(clearLogos);
    const selected = candidates.find((row) => row.selected) || null;
    const hasLogo = Boolean(selected) || hasSelectedClearLogoOnMeta(metadata || {});
    if (hasLogo) {
        return {
            status: 'hasLogo',
            selected: selected || null,
            candidates,
            count: candidates.length,
        };
    }
    if (candidates.length > 0) {
        return {
            status: 'available',
            selected: null,
            candidates,
            count: candidates.length,
        };
    }
    return {
        status: 'none',
        selected: null,
        candidates: [],
        count: 0,
    };
};

export default classifyClearLogoCoverage;
