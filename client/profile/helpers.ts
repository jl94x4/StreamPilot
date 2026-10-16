import { getPublicOrigin, portalUrl, resolvePortalAssetUrl, stripBasePath } from '../shared/basePath';
import { resolveTmdbImageUrl } from '../discovery/tmdbImageUrl';

export const rarityGlow: Record<string, string> = {
    legendary: 'from-amber-400/35 via-amber-500/10 to-[rgb(var(--color-card))]',
    epic: 'from-fuchsia-400/30 via-fuchsia-500/10 to-[rgb(var(--color-card))]',
    rare: 'from-sky-400/28 via-sky-500/10 to-[rgb(var(--color-card))]',
    common: 'from-white/10 via-white/5 to-[rgb(var(--color-card))]',
};

export const DEFAULT_USER_AVATAR = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

export const resolveAvatar = (thumb: string | null | undefined, size = 220) => {
    if (!thumb) return DEFAULT_USER_AVATAR;
    if (thumb.startsWith('http://') || thumb.startsWith('https://') || thumb.startsWith('/api/')) {
        return resolvePortalAssetUrl(thumb);
    }
    return portalUrl(`/api/plex/image?path=${encodeURIComponent(thumb)}&width=${size}&height=${size}`);
};

export const profileAccountIdFromPath = (pathname?: string) => {
    const path = stripBasePath(pathname || (typeof window !== 'undefined' ? window.location.pathname : ''));
    const match = path.match(/^\/profile\/([^/]+)/i);
    if (!match) return '';
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
};

export const profileShareUrl = (accountId?: string | null, isSelf = false) => {
    if (isSelf) return `${getPublicOrigin()}/profile`;
    if (accountId) return `${getPublicOrigin()}/profile/${encodeURIComponent(String(accountId))}`;
    return String(window.location.href || '').split('#')[0];
};

export const goToProfile = (
    onNavigate: ((route: string, options?: { path?: string }) => void) | undefined,
    accountId?: string | number | null,
    username?: string | number | null,
) => {
    const id = String(accountId || username || '').trim();
    if (!id || /^viewer\s+\d+$/i.test(id) || id.toLowerCase() === 'anonymous') return;
    if (onNavigate) {
        onNavigate('profile', { path: `/profile/${encodeURIComponent(id)}` });
        return;
    }
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('portal-open-profile', { detail: { accountId: id } }));
    }
};

export const profileKeyForRequester = (requestedBy?: {
    plexId?: string | number | null;
    plexAccountId?: string | number | null;
    username?: string | null;
    displayName?: string | null;
} | null) => {
    if (!requestedBy) return '';
    const plex = String(requestedBy.plexId || requestedBy.plexAccountId || '').trim();
    const name = String(requestedBy.username || requestedBy.displayName || '').trim();
    return plex || name;
};

export {
    requestDiscoveryPath,
    titleDiscoveryPath,
} from '../../lib/profile/titleDiscoveryPath.js';

export const requestPoster = (item: { posterUrl?: string | null }) => {
    const raw = String(item?.posterUrl || '').trim();
    if (!raw) return '';
    if (raw.startsWith('/api/')) return resolvePortalAssetUrl(raw);
    return resolveTmdbImageUrl(raw, 'w500');
};

export const trophyRarityClass = (rarity: string) => {
    if (rarity === 'legendary') return 'border-amber-400/50 text-amber-100 bg-amber-500/10 hover:border-amber-300/70';
    if (rarity === 'epic') return 'border-fuchsia-400/45 text-fuchsia-100 bg-fuchsia-500/10 hover:border-fuchsia-300/70';
    if (rarity === 'rare') return 'border-sky-400/45 text-sky-100 bg-sky-500/10 hover:border-sky-300/70';
    return 'border-white/10 bg-black/25 hover:border-plex/40';
};

export const relativeFromDays = (days: number | null, t: (key: string, vars?: Record<string, string | number>) => string) => {
    if (days == null) return null;
    if (days <= 0) return t('profilePage.today');
    if (days === 1) return t('profilePage.yesterday');
    if (days < 14) return t('profilePage.daysAgo', { count: days });
    if (days < 60) return t('profilePage.weeksAgo', { count: Math.max(1, Math.round(days / 7)) });
    const months = Math.round(days / 30.44);
    if (months < 24) return t('profilePage.monthsAgo', { count: Math.max(1, months) });
    return t('profilePage.yearsAgo', { count: Math.max(1, Math.round(days / 365.25)) });
};

export const accessStatusTone = (status: string) => {
    const value = String(status || 'unknown').toLowerCase();
    if (value === 'active') return {
        pill: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200',
        glow: 'from-emerald-400/25 via-emerald-500/5 to-transparent',
        icon: 'text-emerald-300',
    };
    if (value === 'pending') return {
        pill: 'border-amber-400/30 bg-amber-500/15 text-amber-200',
        glow: 'from-amber-400/25 via-amber-500/5 to-transparent',
        icon: 'text-amber-300',
    };
    if (value === 'revoked' || value === 'expired') return {
        pill: 'border-rose-400/30 bg-rose-500/15 text-rose-200',
        glow: 'from-rose-400/25 via-rose-500/5 to-transparent',
        icon: 'text-rose-300',
    };
    return {
        pill: 'border-white/15 bg-white/5 text-muted',
        glow: 'from-white/10 via-transparent to-transparent',
        icon: 'text-plex',
    };
};
