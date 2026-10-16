/**
 * Quiet hours helper for Media Automation worker gating.
 * Start/end are "HH:MM" in 24h local time (or the host timezone).
 * When start > end, the window wraps midnight (e.g. 23:00 → 07:00).
 * quietHoursDays: 0=Sun … 6=Sat; empty = every day.
 */

const parseHm = (value, fallbackMinutes) => {
    const raw = String(value || '').trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!match) return fallbackMinutes;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) {
        return fallbackMinutes;
    }
    return (hours * 60) + minutes;
};

export const minutesSinceMidnight = (date = new Date()) => (
    (date.getHours() * 60) + date.getMinutes()
);

const dayAllowed = (settings = {}, date = new Date()) => {
    const days = Array.isArray(settings.quietHoursDays) ? settings.quietHoursDays : [];
    if (!days.length) return true;
    const allowed = new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
    return allowed.has(date.getDay());
};

export const isQuietHoursActive = (settings = {}, date = new Date()) => {
    if (settings.quietHoursEnabled !== true) return false;
    if (!dayAllowed(settings, date)) return false;
    const start = parseHm(settings.quietHoursStart, 23 * 60);
    const end = parseHm(settings.quietHoursEnd, 7 * 60);
    const now = minutesSinceMidnight(date);
    if (start === end) return true; // full-day quiet when equal
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
};

export default isQuietHoursActive;
