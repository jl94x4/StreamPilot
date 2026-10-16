/** Common multi-part public suffixes (e.g. example.co.uk not co.uk). */
export const MULTI_PART_PUBLIC_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
    'com.au', 'net.au', 'org.au',
    'co.nz', 'co.jp', 'com.br',
]);

export const registrableDomainFromHost = (hostname = '') => {
    const parts = String(hostname || '').toLowerCase().split('.').filter(Boolean);
    if (parts.length < 2) return parts.join('.');
    const lastTwo = parts.slice(-2).join('.');
    if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
};
