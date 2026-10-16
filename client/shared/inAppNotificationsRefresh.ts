/** Fired when in-app notification state may have changed (send test, mark read, etc.). */
export const IN_APP_NOTIFICATIONS_CHANGED_EVENT = 'portal-in-app-notifications-changed';

/** Open the in-app notifications bell from Home or other surfaces. */
export const OPEN_IN_APP_NOTIFICATIONS_EVENT = 'portal-open-in-app-notifications';

export const notifyInAppNotificationsChanged = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(IN_APP_NOTIFICATIONS_CHANGED_EVENT));
};

export const openInAppNotifications = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_IN_APP_NOTIFICATIONS_EVENT));
};
