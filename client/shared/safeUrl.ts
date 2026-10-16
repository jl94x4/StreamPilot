/**
 * URL guards for values that end up in href/src attributes. Anything that is not
 * an absolute http(s) URL (e.g. `javascript:`) is rejected so user-entered settings
 * can't be turned into script execution.
 */
export const safeHttpUrl = (value: string | null | undefined): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
        return '';
    }
};

/** Like safeHttpUrl, but also allows same-origin relative paths and local blob: previews. */
export const safeImageSrc = (value: string | null | undefined): string => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw, window.location.origin);
        return ['http:', 'https:', 'blob:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
        return '';
    }
};
