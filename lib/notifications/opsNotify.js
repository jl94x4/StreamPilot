/**
 * Admin ops notifications: ColleXions / Scanner / Status / Media Automation.
 * In-app + web push honor per-admin preferences; ntfy / webhook follow site event toggles.
 */

import { createInAppNotification } from './inAppStore.js';
import { sendWebPushToUser, isWebPushGloballyEnabled, userAllowsWebPush } from './webPush.js';
import { renderEventTemplates } from './templates/render.js';
import { notifyNtfyEvent } from './ntfy.js';
import { sendGenericWebhook } from './genericWebhook.js';
import { buildNotificationPosterUrl } from './mediaMeta.js';
import { resolveArrServiceLogoUrl } from '../arr-notify-identity.js';
import { redactSensitiveText } from './sensitiveText.js';

export const STATUS_NOTIFY_DOWN_DEFAULT_MINUTES = 5;
export const STATUS_NOTIFY_DOWN_MIN_MINUTES = 1;
export const STATUS_NOTIFY_DOWN_MAX_MINUTES = 1440;

const lastSentAt = new Map();

const EVENT_META = {
    collexions_failed: {
        prefKey: 'notifyCollexionsFailed',
        defaultOn: true,
        href: '/collexions',
        notifType: 'collexions_failed',
        pushTag: 'collexions-failed',
        cooldownMs: 30 * 60 * 1000,
        ntfyTags: 'warning,jigsaw',
    },
    scanner_failed: {
        prefKey: 'notifyScannerFailed',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_failed',
        pushTag: 'scanner-failed',
        cooldownMs: 15 * 60 * 1000,
        ntfyTags: 'warning,mag',
    },
    scanner_deleted: {
        prefKey: 'notifyScannerDeleted',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_deleted',
        pushTag: 'scanner-deleted',
        cooldownMs: 30 * 1000,
        ntfyTags: 'wastebasket,mag',
    },
    scanner_upgrade: {
        prefKey: 'notifyScannerUpgrade',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_upgrade',
        pushTag: 'scanner-upgrade',
        cooldownMs: 30 * 1000,
        ntfyTags: 'arrow_up,mag',
    },
    scanner_import: {
        prefKey: 'notifyScannerImport',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_import',
        pushTag: 'scanner-import',
        cooldownMs: 30 * 1000,
        ntfyTags: 'inbox_tray,mag',
    },
    scanner_grab: {
        prefKey: 'notifyScannerGrab',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_grab',
        pushTag: 'scanner-grab',
        cooldownMs: 30 * 1000,
        ntfyTags: 'inbox_tray,arrow_down',
    },
    scanner_update: {
        prefKey: 'notifyScannerUpdate',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_update',
        pushTag: 'scanner-update',
        cooldownMs: 30 * 1000,
        ntfyTags: 'package,arrow_up',
    },
    scanner_interaction: {
        prefKey: 'notifyScannerInteraction',
        defaultOn: true,
        href: '/scanner',
        notifType: 'scanner_interaction',
        pushTag: 'scanner-interaction',
        cooldownMs: 30 * 1000,
        ntfyTags: 'warning,hand',
    },
    spotify_sync_failed: {
        prefKey: 'notifySpotifySyncFailed',
        defaultOn: true,
        href: '/spotify-sync',
        notifType: 'spotify_sync_failed',
        pushTag: 'spotify-sync-failed',
        cooldownMs: 30 * 60 * 1000,
        ntfyTags: 'warning,musical_note',
    },
    status_down: {
        prefKey: 'notifyStatusDown',
        defaultOn: true,
        href: '/status',
        notifType: 'status_down',
        pushTag: 'status-down',
        cooldownMs: 0,
        ntfyTags: 'rotating_light,warning',
    },
    status_up: {
        prefKey: 'notifyStatusUp',
        defaultOn: true,
        href: '/status',
        notifType: 'status_up',
        pushTag: 'status-up',
        cooldownMs: 0,
        ntfyTags: 'white_check_mark',
    },
    media_job_failed: {
        prefKey: 'notifyMediaJobFailed',
        defaultOn: true,
        href: '/media-automation',
        notifType: 'media_job_failed',
        pushTag: 'media-job-failed',
        cooldownMs: 0,
        ntfyTags: 'warning,gear',
    },
    media_job_completed: {
        prefKey: 'notifyMediaJobCompleted',
        defaultOn: false,
        href: '/media-automation',
        notifType: 'media_job_completed',
        pushTag: 'media-job-completed',
        cooldownMs: 0,
        ntfyTags: 'white_check_mark,gear',
    },
    tautulli_api_failed: {
        prefKey: 'notifyTautulliApiFailed',
        defaultOn: true,
        href: '/settings#tautulli',
        notifType: 'tautulli_api_failed',
        pushTag: 'tautulli-api-failed',
        cooldownMs: 30 * 60 * 1000,
        ntfyTags: 'warning,chart_with_downwards_trend',
    },
};

export const OPS_NOTIFY_EVENTS = Object.keys(EVENT_META);

/**
 * Who should receive ops/admin in-app + web-push events.
 * Do not trust a sticky `isAdmin` flag alone — impersonation used to stamp
 * members as admins, which then subscribed them to Tautulli/scanner alerts.
 */
export const isOpsNotifyRecipient = (user = {}, config = {}) => {
    if (!user?.id) return false;
    if (user.jellyfinIsAdmin === true) return true;
    const mediaServerType = String(config?.mediaServerType || 'plex').toLowerCase();
    if (mediaServerType === 'jellyfin' || mediaServerType === 'emby') return false;
    const adminId = String(config?.adminPlexId || '').trim();
    if (adminId) {
        return [user.id, user.plexId]
            .filter(Boolean)
            .some((id) => String(id) === adminId);
    }
    return user.isAdmin === true;
};

export const normalizeStatusNotifyDownAfterMinutes = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return STATUS_NOTIFY_DOWN_DEFAULT_MINUTES;
    return Math.max(
        STATUS_NOTIFY_DOWN_MIN_MINUTES,
        Math.min(STATUS_NOTIFY_DOWN_MAX_MINUTES, Math.round(n)),
    );
};

export const isUnhealthyStatus = (status) => status === 'offline' || status === 'degraded';

/**
 * Track downtime and decide whether to fire down / recovery events.
 * Mutates `record` (`unhealthySince`, `downNotified`).
 */
export const applyStatusHealthNotifyState = ({
    record,
    previousStatus,
    nextStatus,
    now = Date.now(),
    delayMs = STATUS_NOTIFY_DOWN_DEFAULT_MINUTES * 60 * 1000,
} = {}) => {
    if (!record || typeof record !== 'object') return [];
    const isUnhealthy = isUnhealthyStatus(nextStatus);
    const events = [];

    if (isUnhealthy) {
        if (!record.unhealthySince) {
            const openIncident = Array.isArray(record.incidents)
                ? [...record.incidents].reverse().find((incident) => incident && incident.endedAt == null)
                : null;
            record.unhealthySince = Number(openIncident?.startedAt) || now;
        }
        if (!record.downNotified && (now - record.unhealthySince) >= delayMs) {
            record.downNotified = true;
            events.push('status_down');
        }
        return events;
    }

    if (record.downNotified && isUnhealthyStatus(previousStatus)) {
        events.push('status_up');
    }
    record.unhealthySince = null;
    record.downNotified = false;
    return events;
};

export const isCollexionsFailureStatus = (statusMessage = '') => {
    const raw = String(statusMessage || '').trim();
    if (!raw) return false;
    if (/stopped \(interrupt/i.test(raw)) return false;
    if (/sleeping|initializing|running|processing|pinning|idle/i.test(raw) && !/error|crash|fatal|fail/i.test(raw)) {
        return false;
    }
    return /crash|error|fatal|critical|fail/i.test(raw);
};

const adminAllowsEvent = (user, event) => {
    const meta = EVENT_META[event];
    if (!meta) return false;
    const value = user?.[meta.prefKey];
    if (meta.defaultOn) return value !== false;
    return value === true;
};

const shouldSendInApp = (user, event) => adminAllowsEvent(user, event);

const shouldSendWebPush = (config, user, event) => {
    if (!adminAllowsEvent(user, event)) return false;
    if (!isWebPushGloballyEnabled(config)) return false;
    if (!userAllowsWebPush(user)) return false;
    return true;
};

const cooldownAllows = (dedupeKey, cooldownMs, now) => {
    if (!dedupeKey || !cooldownMs) return true;
    const prev = lastSentAt.get(dedupeKey) || 0;
    return now - prev >= cooldownMs;
};

const markCooldown = (dedupeKey, now) => {
    if (dedupeKey) lastSentAt.set(dedupeKey, now);
};

/** @internal tests */
export const resetOpsNotifyCooldownsForTests = () => lastSentAt.clear();

/**
 * Fan-out an ops event to every admin who opted in.
 */
export const notifyOpsAdmins = async ({
    event,
    config,
    title,
    body = '',
    href,
    filename = '',
    service = '',
    serviceKind = '',
    dedupeKey = '',
    cooldownMs: cooldownMsOverride,
    loadUsers,
    log = () => {},
    now = Date.now(),
    meta: extraMeta = {},
    createInApp = createInAppNotification,
} = {}) => {
    const meta = EVENT_META[event];
    if (!meta) return { notified: false, skipped: 'unknown-event' };

    const cooldownMs = Number.isFinite(Number(cooldownMsOverride))
        ? Math.max(0, Number(cooldownMsOverride))
        : (meta.cooldownMs || 0);
    const key = String(dedupeKey || event);
    if (!cooldownAllows(key, cooldownMs, now)) {
        return { notified: false, skipped: 'cooldown' };
    }

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const admins = (Array.isArray(users) ? users : []).filter((u) => isOpsNotifyRecipient(u, config));
    const detailHref = href || meta.href;
    const safeTitle = redactSensitiveText(title || event);
    const safeBody = redactSensitiveText(body || '');
    const { rendered, vars } = renderEventTemplates(config, event, {
        title: safeTitle,
        username: 'admin',
        serverName: config?.serverName || 'StreamPilot',
        portalUrl: detailHref,
        status: event,
        filename,
        service,
        serviceKind,
    });
    const notifTitle = redactSensitiveText(rendered.pushTitle || safeTitle || event);
    const notifBody = redactSensitiveText(rendered.pushBody || safeBody || '');
    const posterUrl = buildNotificationPosterUrl(extraMeta || {});
    const serviceLogoUrl = resolveArrServiceLogoUrl(config, serviceKind, service);
    const artworkMeta = extraMeta && typeof extraMeta === 'object'
        ? {
            ...extraMeta,
            ...(posterUrl ? { posterUrl } : {}),
            ...(serviceKind ? { serviceKind } : {}),
            ...(service ? { service } : {}),
        }
        : {};

    let inAppCreated = 0;
    let webPushSent = 0;

    for (const admin of admins) {
        if (shouldSendInApp(admin, event)) {
            try {
                const created = await createInApp({
                    userId: admin.id,
                    type: meta.notifType,
                    title: notifTitle,
                    body: notifBody,
                    href: detailHref,
                    meta: { ...artworkMeta, skipWebPush: true, opsEvent: event },
                });
                if (created) inAppCreated += 1;
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[ops-notify] in-app failed for ${admin.id}: ${error?.message || error}`);
                }
            }
        }
        if (shouldSendWebPush(config, admin, event)) {
            try {
                const result = await sendWebPushToUser(admin.id, {
                    title: notifTitle,
                    body: notifBody,
                    href: detailHref,
                    type: meta.notifType,
                    tag: `${meta.pushTag}-${key}`.slice(0, 120),
                    image: posterUrl || undefined,
                    icon: serviceLogoUrl || undefined,
                }, { config, user: admin, log });
                if ((result?.sent || 0) > 0) webPushSent += 1;
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[ops-notify] web push failed for ${admin.id}: ${error?.message || error}`);
                }
            }
        }
    }

    let ntfySent = false;
    let webhookSent = false;
    try {
        ntfySent = !!(await notifyNtfyEvent({
            config,
            event,
            title: rendered.ntfyTitle || notifTitle,
            body: rendered.ntfyBody || notifBody,
            clickUrl: detailHref,
            tags: meta.ntfyTags,
            attachUrl: posterUrl,
            log,
        }));
    } catch (error) {
        if (typeof log === 'function') log(`[ops-notify] ntfy failed: ${error?.message || error}`);
    }
    try {
        webhookSent = !!(await sendGenericWebhook({
            config,
            event,
            vars,
            renderedBody: rendered.webhookBody || '',
            log,
        }));
    } catch (error) {
        if (typeof log === 'function') log(`[ops-notify] webhook failed: ${error?.message || error}`);
    }

    const notified = inAppCreated > 0 || webPushSent > 0 || ntfySent || webhookSent;
    markCooldown(key, now);
    return { notified, inAppCreated, webPushSent, ntfySent, webhookSent };
};

export default notifyOpsAdmins;
