/**
 * Members ask for more time near (or after) their expiry; the admin approves or declines with
 * one click and approval extends the expiry date. Pure rules here; storage and routes in index.js.
 */

export const DEFAULT_EXTENSION_MONTH_OPTIONS = [1, 3, 12];
const DEFAULT_SHOW_WITHIN_DAYS = 14;
/** After a decline the member can ask again this much later (no request spam). */
export const DECLINE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const normalizeExtensionSettings = (raw = {}) => {
    const options = [...new Set((Array.isArray(raw?.monthOptions) ? raw.monthOptions : DEFAULT_EXTENSION_MONTH_OPTIONS)
        .map((value) => Math.round(Number(value)))
        .filter((value) => Number.isFinite(value) && value >= 1)
        .map((value) => Math.min(36, value)))]
        .sort((a, b) => a - b)
        .slice(0, 6);
    return {
        enabled: raw?.enabled === true,
        monthOptions: options.length ? options : [...DEFAULT_EXTENSION_MONTH_OPTIONS],
        showWithinDays: clampInt(raw?.showWithinDays, 1, 90, DEFAULT_SHOW_WITHIN_DAYS),
    };
};

/** Whole days from today (local midnight) to the expiry date; null = no expiry (unlimited). */
export const daysUntil = (expiryDate, now = Date.now()) => {
    if (expiryDate == null || expiryDate === '') return null;
    const match = String(expiryDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const expiry = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
};

/**
 * New expiry after approving `months`. Time runs on from the current expiry, or from today when
 * access has already lapsed (so a member who expired last month isn't handed back-dated time).
 */
export const extendExpiryDate = (expiryDate, months, now = Date.now()) => {
    const current = expiryDate ? new Date(expiryDate) : null;
    const base = current && !Number.isNaN(current.getTime()) && current.getTime() > now ? current : new Date(now);
    const next = new Date(base.getTime());
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + Math.max(1, Math.round(Number(months) || 1)));
    // 31 Jan + 1 month = 28/29 Feb, not 3 Mar.
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
    return next.toISOString();
};

/**
 * Whether this member may ask now.
 * @returns {{ ok: boolean, reason?: 'disabled'|'unlimited'|'too_early'|'pending'|'cooldown', daysLeft: number|null }}
 */
export const evaluateExtensionEligibility = ({ user, settings, requests = [], now = Date.now() }) => {
    const daysLeft = daysUntil(user?.expiryDate, now);
    if (!settings?.enabled) return { ok: false, reason: 'disabled', daysLeft };
    if (daysLeft === null) return { ok: false, reason: 'unlimited', daysLeft };
    const mine = requests.filter((row) => String(row?.userId) === String(user?.id));
    if (mine.some((row) => row.status === 'pending')) return { ok: false, reason: 'pending', daysLeft };
    const lastDecline = mine
        .filter((row) => row.status === 'declined')
        .map((row) => Date.parse(row.decidedAt) || 0)
        .sort((a, b) => b - a)[0];
    if (lastDecline && now - lastDecline < DECLINE_COOLDOWN_MS) return { ok: false, reason: 'cooldown', daysLeft };
    if (daysLeft > settings.showWithinDays) return { ok: false, reason: 'too_early', daysLeft };
    return { ok: true, daysLeft };
};

/** Oldest pending first, then the latest decisions (kept to a short history). */
export const sortExtensionRequests = (requests = []) => {
    const pending = requests.filter((row) => row.status === 'pending')
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const decided = requests.filter((row) => row.status !== 'pending')
        .sort((a, b) => String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt)));
    return { pending, decided };
};

/** Keep every pending request and the newest decided ones. */
export const pruneExtensionRequests = (requests = [], keepDecided = 200) => {
    const { pending, decided } = sortExtensionRequests(requests);
    return [...pending, ...decided.slice(0, keepDecided)];
};
