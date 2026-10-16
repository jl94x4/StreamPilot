/**
 * Admin support-ticket notifications: new tickets, member replies, media issues.
 * In-app + web push honor per-admin preferences; ntfy / webhook / Gotify follow site toggles.
 */

import { createInAppNotification } from './inAppStore.js';
import { sendWebPushToUser, isWebPushGloballyEnabled, userAllowsWebPush } from './webPush.js';
import { renderEventTemplates } from './templates/render.js';
import { notifyNtfyEvent } from './ntfy.js';
import { sendGenericWebhook } from './genericWebhook.js';
import { isOpsNotifyRecipient } from './opsNotify.js';

export const SUPPORT_NOTIFY_EVENTS = ['support_ticket', 'support_reply', 'support_media_issue'];

const EVENT_META = {
    support_ticket: {
        prefKey: 'notifySupportTicket',
        defaultOn: true,
        href: '/support',
        notifType: 'support_ticket',
        pushTag: 'support-ticket',
        ntfyTags: 'incoming_envelope,ticket',
        gotifyRule: 'supportTicket',
        fallbackTitle: 'New support ticket',
    },
    support_reply: {
        prefKey: 'notifySupportReply',
        defaultOn: true,
        href: '/support',
        notifType: 'support_reply',
        pushTag: 'support-reply',
        ntfyTags: 'speech_balloon,ticket',
        gotifyRule: 'supportReply',
        fallbackTitle: 'Support ticket reply',
    },
    support_media_issue: {
        prefKey: 'notifySupportMediaIssue',
        defaultOn: true,
        href: '/support',
        notifType: 'support_media_issue',
        pushTag: 'support-media-issue',
        ntfyTags: 'film_frames,warning',
        gotifyRule: 'supportMediaIssue',
        fallbackTitle: 'New media issue ticket',
    },
};

export const absolutePortalHref = (baseUrl, href) => {
    const raw = String(href || '');
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) return raw;
    return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
};

const adminAllowsEvent = (user, event) => {
    const meta = EVENT_META[event];
    if (!meta) return false;
    const value = user?.[meta.prefKey];
    if (meta.defaultOn) return value !== false;
    return value === true;
};

const shouldSendWebPush = (config, user, event) => {
    if (!adminAllowsEvent(user, event)) return false;
    if (!isWebPushGloballyEnabled(config)) return false;
    if (!userAllowsWebPush(user)) return false;
    return true;
};

/**
 * Fan-out a support event to every admin who opted in (except the actor).
 */
export const notifySupportAdmins = async ({
    event,
    config,
    title,
    body = '',
    href,
    excludeUserId = null,
    loadUsers,
    log = () => {},
    meta: extraMeta = {},
    createInApp = createInAppNotification,
    sendWebPush = sendWebPushToUser,
    sendGotifyAlert,
    alertRuleEnabled,
    resolvePublicBaseUrl,
} = {}) => {
    const meta = EVENT_META[event];
    if (!meta) return { notified: false, skipped: 'unknown-event' };

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const skip = excludeUserId != null ? String(excludeUserId) : '';
    const admins = (Array.isArray(users) ? users : []).filter((u) => (
        u && u.id && String(u.id) !== skip && isOpsNotifyRecipient(u, config)
    ));
    const detailHref = href || meta.href;
    const publicBase = typeof resolvePublicBaseUrl === 'function'
        ? String(resolvePublicBaseUrl(config) || '').replace(/\/+$/, '')
        : String(config?.publicDomain || '').replace(/\/+$/, '');
    const clickUrl = absolutePortalHref(publicBase, detailHref);
    const { rendered, vars } = renderEventTemplates(config, event, {
        title: title || event,
        username: extraMeta.username || extraMeta.displayName || 'A member',
        serverName: config?.serverName || 'StreamPilot',
        portalUrl: clickUrl,
        status: event,
    });
    const notifTitle = rendered.pushTitle || meta.fallbackTitle;
    const notifBody = rendered.pushBody || body || '';

    let inAppCreated = 0;
    let webPushSent = 0;

    for (const admin of admins) {
        if (adminAllowsEvent(admin, event)) {
            try {
                const created = await createInApp({
                    userId: admin.id,
                    type: meta.notifType,
                    title: notifTitle,
                    body: notifBody,
                    href: detailHref,
                    meta: { ...extraMeta, skipWebPush: true, supportEvent: event },
                });
                if (created) inAppCreated += 1;
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[support-notify] in-app failed for ${admin.id}: ${error?.message || error}`);
                }
            }
        }
        if (shouldSendWebPush(config, admin, event)) {
            try {
                const result = await sendWebPush(admin.id, {
                    title: notifTitle,
                    body: notifBody,
                    href: detailHref,
                    type: meta.notifType,
                    tag: `${meta.pushTag}-${extraMeta.ticketId || Date.now()}`.slice(0, 120),
                }, { config, user: admin, log });
                if ((result?.sent || 0) > 0) webPushSent += 1;
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[support-notify] web push failed for ${admin.id}: ${error?.message || error}`);
                }
            }
        }
    }

    let ntfySent = false;
    let webhookSent = false;
    let gotifySent = false;
    try {
        ntfySent = !!(await notifyNtfyEvent({
            config,
            event,
            title: rendered.ntfyTitle || notifTitle,
            body: rendered.ntfyBody || notifBody,
            clickUrl,
            tags: meta.ntfyTags,
            log,
        }));
    } catch (error) {
        if (typeof log === 'function') log(`[support-notify] ntfy failed: ${error?.message || error}`);
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
        if (typeof log === 'function') log(`[support-notify] webhook failed: ${error?.message || error}`);
    }

    const gotifyAllowed = typeof alertRuleEnabled !== 'function'
        || alertRuleEnabled(config, meta.gotifyRule);
    if (gotifyAllowed && typeof sendGotifyAlert === 'function') {
        try {
            gotifySent = !!(await sendGotifyAlert(
                config,
                rendered.gotifyTitle || notifTitle,
                rendered.gotifyBody || notifBody,
            ));
        } catch (error) {
            if (typeof log === 'function') log(`[support-notify] Gotify failed: ${error?.message || error}`);
        }
    }

    const notified = inAppCreated > 0 || webPushSent > 0 || ntfySent || webhookSent || gotifySent;
    return { notified, inAppCreated, webPushSent, ntfySent, webhookSent, gotifySent };
};

export default notifySupportAdmins;
