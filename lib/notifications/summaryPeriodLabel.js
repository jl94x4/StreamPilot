const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date) => {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next.getTime();
};

const localDayDelta = (when, now) => (
    Math.round((startOfLocalDay(now) - startOfLocalDay(when)) / MS_PER_DAY)
);

export const formatStoredSummaryPeriodLabel = (digest = {}, now = new Date()) => {
    if (!digest || typeof digest !== 'object') return 'Summary';
    const iso = digest.periodEnd || digest.createdAt;
    const when = iso ? new Date(iso) : null;
    if (!when || !Number.isFinite(when.getTime())) return digest.periodLabel || 'Summary';
    const frequency = String(digest.frequency || '').toLowerCase();
    const delta = localDayDelta(when, now);

    if (frequency === 'weekly') {
        if (delta >= 0 && delta < 7) return 'This week';
        return `Week of ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    }
    if (frequency === 'monthly') {
        if (when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()) return 'This month';
        return when.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) return when.toLocaleDateString(undefined, { weekday: 'long' });
    return when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};
