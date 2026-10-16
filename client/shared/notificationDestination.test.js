import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Mirror of client/shared/notificationDestination.ts for backend-free unit coverage.
 * Keep behavior aligned when changing either file.
 */
const REQUEST_TYPES = new Set([
    'request_available',
    'request_approved',
    'request_declined',
    'request_season_available',
    'request_new_episode',
]);

const parseReviewId = (href = '', meta = {}) => {
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

const resolveNotificationDestination = (item = {}) => {
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
        return { kind: 'home', labelKey: 'notifications.openHome' };
    }
    if (href.startsWith('/settings')) {
        return { kind: 'settings', labelKey: 'notifications.openSettings' };
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
    if (href && href.startsWith('/') && !href.startsWith('//')) {
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
    if (type === 'request_declined' || REQUEST_TYPES.has(type)) {
        return { kind: 'discovery', path: '/discovery/requests', labelKey: 'notifications.openMyRequests' };
    }
    return { kind: 'discovery', path: '/discovery/requests', labelKey: 'notifications.openMyRequests' };
};

test('media detail href stays on Discover title page', () => {
    const dest = resolveNotificationDestination({
        type: 'request_available',
        href: '/discovery/movie/123',
    });
    assert.equal(dest.kind, 'discovery');
    assert.equal(dest.path, '/discovery/movie/123');
});

test('admin pending href opens discover review queue', () => {
    const dest = resolveNotificationDestination({
        type: 'admin_pending',
        href: '/requests?review=42',
    });
    assert.equal(dest.kind, 'discovery');
    assert.equal(dest.path, '/discovery/queue?review=42');
});

test('admin pending falls back to meta.requestId', () => {
    const dest = resolveNotificationDestination({
        type: 'admin_pending',
        href: '',
        meta: { requestId: 9 },
    });
    assert.equal(dest.kind, 'discovery');
    assert.equal(dest.path, '/discovery/queue?review=9');
});

test('declined without href opens my requests', () => {
    const dest = resolveNotificationDestination({ type: 'request_declined' });
    assert.equal(dest.kind, 'discovery');
    assert.equal(dest.path, '/discovery/requests');
});

test('admin test opens home', () => {
    const dest = resolveNotificationDestination({ type: 'admin_test', href: '/portal' });
    assert.equal(dest.kind, 'home');
});

test('support ticket href opens support inbox', () => {
    const dest = resolveNotificationDestination({
        type: 'support_ticket',
        href: '/support?ticket=12',
    });
    assert.equal(dest.kind, 'support');
    assert.equal(dest.path, '/support?ticket=12');
});

test('ops alerts deep-link to the matching admin page', () => {
    assert.deepEqual(resolveNotificationDestination({ type: 'collexions_failed', href: '/collexions' }), {
        kind: 'route', route: 'collexions', labelKey: 'notifications.openCollexions',
    });
    assert.equal(resolveNotificationDestination({ type: 'scanner_failed' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_deleted' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_upgrade' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_import' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_grab' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_update' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'scanner_interaction' }).route, 'scanner');
    assert.equal(resolveNotificationDestination({ type: 'status_down' }).route, 'status');
    assert.equal(resolveNotificationDestination({ type: 'media_job_completed' }).route, 'media-automation');
});
