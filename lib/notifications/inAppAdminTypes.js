/**
 * In-app notification types that are for server operators only.
 * Members (and impersonation sessions) must never receive these from GET /api/notifications.
 *
 * `support_ticket` is intentionally omitted: members also receive that type when
 * an admin replies to *their* ticket. Admin fan-out rows are tagged with
 * `meta.supportEvent` (and newer rows use support_reply / support_media_issue).
 */

export const ADMIN_ONLY_IN_APP_TYPES = new Set([
    'admin_pending',
    'admin_test',
    'collexions_failed',
    'scanner_failed',
    'scanner_deleted',
    'scanner_upgrade',
    'scanner_import',
    'scanner_grab',
    'scanner_update',
    'scanner_interaction',
    'spotify_sync_failed',
    'status_down',
    'status_up',
    'media_job_failed',
    'media_job_completed',
    'tautulli_api_failed',
    'support_reply',
    'support_media_issue',
]);

export const isAdminOnlyInAppNotificationType = (type) => (
    ADMIN_ONLY_IN_APP_TYPES.has(String(type || ''))
);

/** True when this stored row must not appear in a member (or impersonation) bell. */
export const isAdminOnlyInAppNotificationItem = (item) => {
    if (isAdminOnlyInAppNotificationType(item?.type)) return true;
    const supportEvent = String(item?.meta?.supportEvent || '').trim();
    return supportEvent === 'support_ticket'
        || supportEvent === 'support_reply'
        || supportEvent === 'support_media_issue';
};

export default ADMIN_ONLY_IN_APP_TYPES;
