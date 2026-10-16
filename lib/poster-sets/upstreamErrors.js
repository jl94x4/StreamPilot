/**
 * Cloudflare 520–530 are origin/edge failures on MediUX / ThePosterDB, not portal bugs.
 * Keep "Status code: NNN" in the message so existing UI checks still match.
 */

const CLOUDFLARE_ORIGIN_HINTS = {
    520: 'origin returned an unknown error',
    521: 'the origin web server is down',
    522: 'connection to origin timed out',
    523: 'origin is unreachable',
    524: 'origin timed out',
    525: 'SSL handshake with origin failed',
    526: 'origin SSL certificate is invalid',
    527: 'Railgun error',
    530: 'origin DNS failed or origin is unreachable',
};

export const posterSetsUpstreamStatusCode = (message) => {
    const text = String(message || '');
    const match = text.match(/\bStatus code:\s*(5(?:2[0-7]|30))\b/i)
        || text.match(/\bCloudflare\s+(5(?:2[0-7]|30))\b/i);
    return match ? Number(match[1]) : null;
};

export const isPosterSetsUpstreamOutage = (message) => {
    const text = String(message || '');
    if (posterSetsUpstreamStatusCode(text) != null) return true;
    return /temporarily unreachable/i.test(text);
};

export const posterSetsHostLabel = (url, message = '') => {
    const hay = `${url || ''} ${message || ''}`.toLowerCase();
    if (hay.includes('mediux')) return 'MediUX';
    if (hay.includes('theposterdb') || hay.includes('posterdb') || /\btpdb\b/.test(hay)) {
        return 'ThePosterDB';
    }
    return 'The poster site';
};

export const explainPosterSetsPageError = (message, url = '') => {
    const text = String(message || '').trim();
    if (!text) return text;
    const code = posterSetsUpstreamStatusCode(text);
    if (!code) return text;
    if (/temporarily unreachable/i.test(text)) return text;
    const host = posterSetsHostLabel(url, text);
    const hint = CLOUDFLARE_ORIGIN_HINTS[code] || 'edge/origin failure';
    return (
        `${host} is temporarily unreachable (Cloudflare ${code}: ${hint}). `
        + `This is ${host}'s site, not the portal. Try again in a few minutes. `
        + `Status code: ${code}`
    );
};

export const isFailedPosterSetsJobState = (state) => (
    ['failed', 'error'].includes(String(state || '').toLowerCase())
);

export const isFailedPosterSetsAuditEntry = (entry) => {
    if (!entry) return false;
    const state = String(entry.state || '').toLowerCase();
    if (state === 'warning' || state === 'warn') return false;
    if (entry.error) return true;
    return isFailedPosterSetsJobState(entry.state);
};
