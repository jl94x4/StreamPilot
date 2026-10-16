/**
 * Sonarr / Radarr / Lidarr identity for scanner notifications.
 * OS push bodies are plain text (no inline images), so we expose an emoji mark
 * plus a bundled logo path for in-app UI and the web-push icon.
 */

export const ARR_SERVICE_KINDS = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr'];

export const ARR_SERVICE_MARKS = {
    sonarr: '📺',
    radarr: '🎬',
    lidarr: '🎵',
    readarr: '📚',
    whisparr: '🎞',
};

const KIND_SET = new Set(ARR_SERVICE_KINDS);

export const normalizeArrServiceKind = (kind, serviceName = '') => {
    const k = String(kind || '').toLowerCase().trim();
    if (KIND_SET.has(k)) return k;
    const s = String(serviceName || '').toLowerCase();
    for (const id of ARR_SERVICE_KINDS) {
        if (s.includes(id)) return id;
    }
    return '';
};

export const arrServiceMark = (kind, serviceName = '') => {
    const id = normalizeArrServiceKind(kind, serviceName);
    return id ? `${ARR_SERVICE_MARKS[id]} ` : '';
};

export const arrServiceLogoPath = (kind, serviceName = '') => {
    const id = normalizeArrServiceKind(kind, serviceName);
    return id ? `/static/applets/${id}.png` : '';
};

export const resolveArrServiceLogoUrl = (config = {}, kind, serviceName = '') => {
    const logoPath = arrServiceLogoPath(kind, serviceName);
    if (!logoPath) return '';
    const base = String(config.publicDomain || '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    return `${base}${logoPath}`;
};
