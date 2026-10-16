/**
 * Resolve where an in-app notification should navigate when clicked.
 * Prefer an explicit href; fall back intelligently by notification type.
 */

export type NotificationDestination =
    | { kind: 'discovery'; path: string; labelKey: string }
    | { kind: 'requests'; reviewId?: number; labelKey: string }
    | { kind: 'home'; labelKey: string }
    | { kind: 'settings'; labelKey: string }
    | { kind: 'support'; path: string; labelKey: string }
    | { kind: 'route'; route: string; labelKey: string }
    | { kind: 'summary'; digestId: string; labelKey: string }
    | { kind: 'external'; href: string; labelKey: string };

export type NotificationLike = {
    type?: string | null;
    href?: string | null;
    meta?: {
        requestId?: string | number | null;
        mediaType?: string | null;
        tmdbId?: string | number | null;
        [key: string]: unknown;
    } | null;
};

const REQUEST_TYPES = new Set([
    'request_available',
    'request_approved',
    'request_declined',
    'request_season_available',
    'request_new_episode',
]);

const parseReviewId = (href: string, meta?: NotificationLike['meta']): number | undefined => {
    try {
        const url = new URL(href, 'http://local.invalid');
        const fromQuery = Number(url.searchParams.get('review'));
        if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery;
    } catch {
        // ignore
    }
    const fromMeta = Number(meta?.requestId);
    if (Number.isFinite(fromMeta) && fromMeta > 0) return fromMeta;
    return undefined;
};

const isInternalPath = (href: string) => href.startsWith('/');

export const resolveNotificationDestination = (item: NotificationLike): NotificationDestination => {
    const type = String(item?.type || '').trim();
    const href = String(item?.href || '').trim();
    const meta = item?.meta && typeof item.meta === 'object' ? item.meta : null;

    if (href.startsWith('/discovery')) {
        const isQueue = href.includes('/discovery/queue');
        return {
            kind: 'discovery',
            path: href,
            labelKey: isQueue
                ? 'notifications.openRequestQueue'
                : href.includes('/requests')
                    ? 'notifications.openMyRequests'
                    : 'notifications.openInDiscover',
        };
    }

    if (href.startsWith('/support') || type === 'support_ticket' || type === 'support_reply' || type === 'support_media_issue') {
        return {
            kind: 'support',
            path: href.startsWith('/support') ? href : '/support',
            labelKey: 'notifications.openSupport',
        };
    }

    if (href.startsWith('/requests')) {
        const reviewId = parseReviewId(href, meta);
        return {
            kind: 'discovery',
            path: reviewId ? `/discovery/queue?review=${reviewId}` : '/discovery/queue',
            labelKey: 'notifications.openRequestQueue',
        };
    }

    if (href === '/portal' || href === '/') {
        try {
            const url = new URL(href, 'http://local.invalid');
            const summaryId = url.searchParams.get('summary');
            if (summaryId) {
                return { kind: 'summary', digestId: summaryId, labelKey: 'notifications.openSummary' };
            }
        } catch {
            // ignore
        }
        return { kind: 'home', labelKey: 'notifications.openHome' };
    }

    if (type === 'summary_digest' || href.includes('summary=')) {
        let digestId = 'latest';
        try {
            const url = new URL(href || '/portal?summary=latest', 'http://local.invalid');
            digestId = url.searchParams.get('summary') || 'latest';
        } catch {
            digestId = 'latest';
        }
        return { kind: 'summary', digestId, labelKey: 'notifications.openSummary' };
    }

    if (href.startsWith('/settings')) {
        return { kind: 'settings', labelKey: 'notifications.openSettings' };
    }

    if (href.startsWith('/spotify-sync') || type === 'spotify_sync_failed') {
        return { kind: 'route', route: 'spotify-sync', labelKey: 'navigation.spotifySync' };
    }
    if (href.startsWith('/collexions') || type === 'collexions_failed') {
        return { kind: 'route', route: 'collexions', labelKey: 'notifications.openCollexions' };
    }
    if (href.startsWith('/scanner') || type === 'scanner_failed' || type === 'scanner_deleted' || type === 'scanner_upgrade' || type === 'scanner_import' || type === 'scanner_grab' || type === 'scanner_update' || type === 'scanner_interaction') {
        return { kind: 'route', route: 'scanner', labelKey: 'notifications.openScanner' };
    }
    if (href.startsWith('/status') || type === 'status_down' || type === 'status_up') {
        return { kind: 'route', route: 'status', labelKey: 'notifications.openStatus' };
    }
    if (href.startsWith('/media-automation') || type === 'media_job_failed' || type === 'media_job_completed') {
        return { kind: 'route', route: 'media-automation', labelKey: 'notifications.openMediaAutomation' };
    }

    if (href && isInternalPath(href) && !href.startsWith('//')) {
        // Unknown internal path — keep as SPA-agnostic absolute navigation.
        return { kind: 'external', href, labelKey: 'notifications.openLink' };
    }

    if (type === 'admin_pending') {
        const reviewId = parseReviewId('', meta);
        return {
            kind: 'discovery',
            path: reviewId ? `/discovery/queue?review=${reviewId}` : '/discovery/queue',
            labelKey: 'notifications.openRequestQueue',
        };
    }

    if (type === 'admin_test') {
        return { kind: 'home', labelKey: 'notifications.openHome' };
    }

    if (type === 'request_not_released') {
        return { kind: 'discovery', path: href || '/discovery/requests', labelKey: 'notifications.openInDiscover' };
    }

    if (type === 'request_declined' || REQUEST_TYPES.has(type)) {
        return { kind: 'discovery', path: '/discovery/requests', labelKey: 'notifications.openMyRequests' };
    }
    return { kind: 'discovery', path: '/discovery/requests', labelKey: 'notifications.openMyRequests' };
};

export default resolveNotificationDestination;
