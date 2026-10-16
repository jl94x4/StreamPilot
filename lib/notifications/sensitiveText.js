/**
 * Strip credentials from notification copy and fetch errors.
 * node-fetch includes the full request URL in `error.message`, which is how
 * Tautulli `apikey=` values were landing in the in-app bell.
 */

const SENSITIVE_KEYS = [
    'apikey',
    'api_key',
    'api-key',
    'access_token',
    'auth_token',
    'refresh_token',
    'password',
    'secret',
    'token',
    'plex_token',
    'x-plex-token',
    'authorization',
].join('|');

const QUERY_RE = new RegExp(`([?&](?:${SENSITIVE_KEYS})=)([^&#\\s]+)`, 'gi');
const PAIR_RE = new RegExp(`((?:${SENSITIVE_KEYS})["'\\s:=]+)([^\\s&"'\\\\]+)`, 'gi');
const USERINFO_RE = /(\w+:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

export const redactSensitiveText = (value) => {
    let text = String(value ?? '');
    if (!text) return text;
    text = text.replace(USERINFO_RE, '$1$2:***@');
    text = text.replace(QUERY_RE, '$1***');
    text = text.replace(PAIR_RE, '$1***');
    return text;
};

const redactRepeatEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    return {
        ...entry,
        body: redactSensitiveText(entry.body),
    };
};

export const redactInAppNotificationItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : item.meta;
    const nextMeta = meta && typeof meta === 'object'
        ? {
            ...meta,
            ...(Array.isArray(meta.repeatHistory)
                ? { repeatHistory: meta.repeatHistory.map(redactRepeatEntry) }
                : {}),
        }
        : meta;
    return {
        ...item,
        title: redactSensitiveText(item.title),
        body: redactSensitiveText(item.body),
        meta: nextMeta,
    };
};

export default redactSensitiveText;
