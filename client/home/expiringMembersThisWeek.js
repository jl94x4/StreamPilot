const MS_PER_DAY = 1000 * 60 * 60 * 24;

const parseLocalDate = (dateString) => {
    if (dateString == null || dateString === '') return null;
    const datePart = String(dateString).split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    if (year && month && day) return new Date(year, month - 1, day);
    const parsed = new Date(dateString);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const daysUntilExpiry = (expiryDate, now = new Date()) => {
    const expiry = parseLocalDate(expiryDate);
    if (!expiry) return null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / MS_PER_DAY);
};

export const isExpiringMemberThisWeek = (user, now = new Date()) => {
    if (!user || user.isAdmin) return false;
    const status = String(user.plexAccessStatus || '').toLowerCase();
    if (status === 'revoked') return false;
    const days = daysUntilExpiry(user.expiryDate, now);
    return days !== null && days >= 0 && days <= 7;
};

export const filterExpiringMembersThisWeek = (users, now = new Date()) => (
    (Array.isArray(users) ? users : [])
        .filter((user) => isExpiringMemberThisWeek(user, now))
        .sort((a, b) => (daysUntilExpiry(a.expiryDate, now) ?? 99) - (daysUntilExpiry(b.expiryDate, now) ?? 99))
);
