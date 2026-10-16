import type { PortalRequestItem } from '../requests/types';

/** Convert a portal request DTO into a discovery-row compatible item. */
export const portalRequestToDiscoveryRowItem = (item: PortalRequestItem) => ({
    type: item.type,
    status: item.status,
    id: item.type === 'music' ? (item.mbid || item.id) : item.id,
    mbid: item.mbid || null,
    isDownloading: !!item.isDownloading,
    media: {
        tmdbId: item.tmdbId,
        mbid: item.mbid || null,
        title: item.title,
        name: item.title,
        posterPath: item.posterPath || null,
        mediaType: item.type,
        status: item.mediaStatus,
    },
    mediaInfo: {
        status: item.mediaStatus,
        requests: [{
            id: item.id,
            status: item.status,
            is4k: !!item.is4k,
            seasons: Array.isArray(item.seasons) ? item.seasons : [],
        }],
        ...(item.isDownloading ? { downloadStatus: [{ status: 'downloading' }] } : {}),
    },
});

/** One discovery poster for a title that may have both HD and 4K request rows. */
export const mergedPortalRequestsToDiscoveryRowItem = (
    primary: PortalRequestItem,
    variants: PortalRequestItem[],
) => {
    const rows = variants.length ? variants : [primary];
    const downloading = rows.some((row) => !!row.isDownloading);
    const mediaStatuses = rows
        .map((row) => Number(row.mediaStatus))
        .filter((value) => Number.isFinite(value));
    const mediaStatus = mediaStatuses.length
        ? Math.max(...mediaStatuses)
        : primary.mediaStatus;

    return {
        ...portalRequestToDiscoveryRowItem(primary),
        isDownloading: downloading,
        media: {
            tmdbId: primary.tmdbId,
            title: primary.title,
            name: primary.title,
            posterPath: primary.posterPath || null,
            mediaType: primary.type,
            status: mediaStatus,
        },
        mediaInfo: {
            status: mediaStatus,
            requests: rows.map((row) => ({
                id: row.id,
                status: row.status,
                is4k: !!row.is4k,
                seasons: Array.isArray(row.seasons) ? row.seasons : [],
            })),
            ...(downloading ? { downloadStatus: [{ status: 'downloading' }] } : {}),
        },
    };
};

/** Merge HD/4K portal requests, then map to discovery row items (one poster per title). */
export const portalRequestsToDiscoveryRowItems = (items: PortalRequestItem[]) => (
    mergeHd4kMemberRequests(items).map(({ primary, variants }) => (
        mergedPortalRequestsToDiscoveryRowItem(primary, variants)
    ))
);

export const memberRequestStatusClass = (label: string) => {
    if (label === 'Available') return 'bg-green-500/15 text-green-400 border-green-500/25';
    if (label === 'Processing' || label === 'Approved') return 'bg-blue-500/15 text-blue-300 border-blue-500/25';
    if (label === 'Requested') return 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25';
    if (label === 'Pending Approval') return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
    if (label === 'Declined') return 'bg-red-500/15 text-red-400 border-red-500/25';
    if (label === 'Failed') return 'bg-red-500/15 text-red-300 border-red-500/30';
    return 'bg-white/5 text-white/60 border-white/10';
};

export const memberRequestDisplayStatus = (item: PortalRequestItem) => {
    const status = Number(item.status);
    const mediaStatus = Number(item.mediaStatus);
    if (status === 3) return 'Declined';
    if (status === 4) return 'Failed';
    if (status === 1) return 'Pending Approval';
    // Downloads in flight always win over Seerr's optimistic Available/Partial.
    if (status === 2 && item.isDownloading) return 'Processing';
    if (status === 2 && mediaStatus === 5) return 'Available';
    if (status === 2 && mediaStatus === 4) return item.type === 'tv' || item.type === 'music' ? 'Requested' : 'Available';
    if (status === 2 && mediaStatus === 3) return 'Requested';
    if (status === 2) return 'Approved';
    return item.statusLabel || 'Unknown';
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export const formatRequestRelativeTime = (value?: string | null, t?: Translate) => {
    if (!value) return t ? t('common.unknownTime') : 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t ? t('common.justNow') : 'Just now';
    if (minutes < 60) return t ? t('common.minutesAgo', { count: minutes }) : `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t ? t('common.hoursAgo', { count: hours }) : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return t ? t('common.daysAgo', { count: days }) : `${days}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Group HD + 4K rows for the same title into one My Requests card. */
export type MergedMemberRequest = {
    key: string;
    primary: PortalRequestItem;
    variants: PortalRequestItem[];
};

const requestGroupKey = (item: PortalRequestItem) => {
    if (item.type === 'music') {
        const mbid = String(item.mbid || '').trim();
        const albumMbid = String(item.albumMbid || '').trim();
        if (mbid) return `music:${mbid}:${albumMbid || 'artist'}`;
    }
    if (item.tmdbId != null && Number.isFinite(Number(item.tmdbId)) && Number(item.tmdbId) > 0) {
        return `${item.type || 'movie'}:${Number(item.tmdbId)}`;
    }
    return `id:${item.id}`;
};

const requestRecency = (item: PortalRequestItem) => {
    const raw = item.updatedAt || item.createdAt;
    if (!raw) return 0;
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : 0;
};

const qualityRank = (item: PortalRequestItem) => (item.is4k ? 1 : 0);

/**
 * Merge portal request rows that share type + tmdbId (typically HD + 4K).
 * Preserves first-seen list order; variants sorted HD then 4K.
 */
export const mergeHd4kMemberRequests = (items: PortalRequestItem[]): MergedMemberRequest[] => {
    const order: string[] = [];
    const groups = new Map<string, PortalRequestItem[]>();

    for (const item of items) {
        const key = requestGroupKey(item);
        if (!groups.has(key)) {
            groups.set(key, []);
            order.push(key);
        }
        groups.get(key)!.push(item);
    }

    return order.map((key) => {
        const variants = [...(groups.get(key) || [])].sort((a, b) => {
            const q = qualityRank(a) - qualityRank(b);
            if (q !== 0) return q;
            return requestRecency(b) - requestRecency(a);
        });
        const primary = [...variants].sort((a, b) => requestRecency(b) - requestRecency(a))[0] || variants[0];
        return { key, primary, variants };
    });
};

export const requestQualityLabel = (item: PortalRequestItem) => (item.is4k ? '4K' : 'HD');
