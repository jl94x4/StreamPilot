import type { PortalRequestItem, PortalRequestUser } from './types';

export type AdminRequestFilter = 'pending' | 'processing' | 'available' | 'failed' | 'approved' | 'declined';

export type RequestListFilters = {
    requesterId: string;
    mediaType: 'all' | 'movie' | 'tv' | 'music';
    quality: 'all' | 'hd' | '4k';
    dateRange: 'all' | '7d' | '30d';
    search: string;
};

export const portalRequestArrSegment = (type?: string | null) => (
    type === 'tv' ? 'sonarr' : type === 'music' ? 'lidarr' : 'radarr'
);

export const portalRequestTypeLabelKey = (type?: string | null) => (
    type === 'tv' ? 'mediaType.tv' : type === 'music' ? 'mediaType.music' : 'mediaType.movie'
);

export const defaultRequestListFilters = (): RequestListFilters => ({
    requesterId: '',
    mediaType: 'all',
    quality: 'all',
    dateRange: 'all',
    search: '',
});

const matchesDateRange = (item: PortalRequestItem, dateRange: RequestListFilters['dateRange']) => {
    if (dateRange === 'all') return true;
    const raw = item.createdAt || item.updatedAt;
    if (!raw) return true;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return true;
    const days = dateRange === '7d' ? 7 : 30;
    return Date.now() - date.getTime() <= days * 86_400_000;
};

export const filterPortalRequests = (
    items: PortalRequestItem[],
    filters: RequestListFilters,
): PortalRequestItem[] => {
    const query = filters.search.trim().toLowerCase();
    const requesterId = filters.requesterId ? Number(filters.requesterId) : null;

    return items.filter((item) => {
        if (requesterId && Number(item.requestedBy?.id) !== requesterId) return false;
        if (filters.mediaType !== 'all' && item.type !== filters.mediaType) return false;
        if (filters.quality === '4k' && !item.is4k) return false;
        if (filters.quality === 'hd' && item.is4k) return false;
        if (!matchesDateRange(item, filters.dateRange)) return false;
        if (query) {
            const haystack = [
                item.title,
                item.year,
                item.requestedBy?.displayName,
                item.requestedBy?.email,
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
};

export const buildRequesterOptions = (users: PortalRequestUser[], requests: PortalRequestItem[]) => {
    const seen = new Map<string, string>();
    for (const user of users) {
        if (user.id != null && String(user.id) !== '') {
            seen.set(String(user.id), user.displayName);
        }
    }
    for (const item of requests) {
        const id = item.requestedBy?.id;
        if (id != null && item.requestedBy.displayName) {
            seen.set(String(id), item.requestedBy.displayName);
        }
    }
    return Array.from(seen.entries())
        .map(([id, label]) => ({ value: id, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
};
