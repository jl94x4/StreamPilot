/**
 * Phase 4 / #89 — notify requester when a request isn't released yet.
 */

import { createInAppNotification } from './inAppStore.js';
import { inAppRequestMeta, resolveMediaType } from './mediaMeta.js';
import { sendWebPushToUser, isWebPushGloballyEnabled, userAllowsWebPush } from './webPush.js';
import { buildRequestDetailPath, buildRequestAvailableEmailHtml } from './requestAvailable.js';
import { renderEventTemplates } from './templates/render.js';
import {
    formatReleaseDateLabel,
    isFutureReleaseDate,
    normalizeReleaseDatePreference,
    pickPreferredRelease,
} from './releaseDates.js';

const userPrefDefaultOn = (user, key) => user?.[key] !== false;

export const isNotReleasedNotifyEnabled = (config = {}) => config?.requestNotReleasedNotifyEnabled !== false;

export const shouldSendNotReleased = (config, user, channel) => {
    if (!isNotReleasedNotifyEnabled(config)) return false;
    if (channel === 'email') {
        return config?.requestNotReleasedNotifyEmail !== false && userPrefDefaultOn(user, 'notifyRequestNotReleasedEmail');
    }
    if (channel === 'inApp') {
        return config?.requestNotReleasedNotifyInApp !== false && userPrefDefaultOn(user, 'notifyRequestNotReleasedInApp');
    }
    if (channel === 'webPush') {
        return config?.requestNotReleasedNotifyWebPush !== false
            && isWebPushGloballyEnabled(config)
            && userAllowsWebPush(user)
            && userPrefDefaultOn(user, 'notifyRequestNotReleasedWebPush');
    }
    return false;
};

export const buildReleaseMetaFromDetails = (config = {}, details = {}, mediaType = 'movie') => {
    const preference = normalizeReleaseDatePreference(config.notifyReleaseDatePreference);
    const region = String(config.discoverRegion || config.tmdbRegion || 'US').toUpperCase() || 'US';
    const picked = pickPreferredRelease({
        preference,
        releases: details?.releases || details?.release_dates || null,
        releaseDate: details?.releaseDate || details?.release_date || null,
        firstAirDate: mediaType === 'tv'
            ? (details?.firstAirDate || details?.first_air_date || null)
            : null,
        region,
    });
    if (!picked?.date) return null;
    return {
        preference,
        region,
        selectedDate: picked.date,
        selectedType: picked.type,
        selectedLabel: picked.label,
        candidates: picked.candidates || {},
        isFuture: isFutureReleaseDate(picked.date),
        formatted: formatReleaseDateLabel(picked.date),
    };
};

/**
 * @returns {{ notified: boolean, skipped?: string, release?: object }}
 */
export const notifyRequestNotReleasedYet = async ({
    config,
    record,
    releaseMeta = null,
    loadUsers,
    sendEmail,
    hasEmailBeenSent,
    logEmailSent,
    resolvePublicBaseUrl,
    log = () => {},
} = {}) => {
    if (!record?.id) return { notified: false, skipped: 'no-record' };
    if (record.mediaType === 'music') return { notified: false, skipped: 'music' };
    if (!isNotReleasedNotifyEnabled(config)) return { notified: false, skipped: 'disabled' };
    if (record?.meta?.notReleasedNotifiedAt) return { notified: false, skipped: 'already-notified' };

    const release = releaseMeta
        || (record?.meta?.releaseDate
            ? {
                selectedDate: record.meta.releaseDate,
                selectedType: record.meta.releaseDateType || 'tmdb',
                selectedLabel: record.meta.releaseDateLabel || 'Release date',
                formatted: formatReleaseDateLabel(record.meta.releaseDate),
                isFuture: isFutureReleaseDate(record.meta.releaseDate),
            }
            : null);

    if (!release?.selectedDate || !release.isFuture) {
        return { notified: false, skipped: 'not-future', release };
    }

    const users = typeof loadUsers === 'function' ? await loadUsers() : [];
    const user = (Array.isArray(users) ? users : []).find((u) => (
        String(u?.id) === String(record.userId)
        || (record?.meta?.requestedByEmail && String(u?.email || '').toLowerCase() === String(record.meta.requestedByEmail).toLowerCase())
        || (record?.meta?.requestedByName && String(u?.username || '').toLowerCase() === String(record.meta.requestedByName).toLowerCase())
    )) || null;

    const username = user?.username || record?.meta?.requestedByName || 'there';
    const title = record?.title || 'Your request';
    const year = record?.year || null;
    const mediaType = resolveMediaType(record);
    const detailPath = buildRequestDetailPath(record);
    const baseUrl = typeof resolvePublicBaseUrl === 'function'
        ? String(resolvePublicBaseUrl(config) || '').replace(/\/+$/, '')
        : '';
    const ctaUrl = baseUrl ? `${baseUrl}${detailPath.startsWith('/') ? detailPath : `/${detailPath}`}` : detailPath;
    const releasePretty = release.formatted || release.selectedDate;
    const releaseKind = release.selectedLabel || 'Release date';

    const { rendered } = renderEventTemplates(config, 'not_released', {
        title,
        username,
        mediaType,
        year,
        serverName: config?.serverName || 'StreamPilot',
        portalUrl: ctaUrl,
        status: 'Not released yet',
        release_date: releasePretty,
        release_type: releaseKind,
    });

    let emailSent = false;
    let inAppCreated = false;
    let webPushSent = false;

    if (shouldSendNotReleased(config, user, 'inApp')) {
        const targetUserId = user?.id || record.userId;
        if (targetUserId) {
            await createInAppNotification({
                userId: targetUserId,
                type: 'request_not_released',
                title: rendered.pushTitle || `${title} isn’t released yet`,
                body: rendered.pushBody || `${releaseKind}: ${releasePretty}. We’ll notify you when it’s available.`,
                href: detailPath,
                meta: inAppRequestMeta(record, {
                    releaseDate: release.selectedDate,
                    releaseDateType: release.selectedType,
                }),
            });
            inAppCreated = true;
        }
    }

    if (shouldSendNotReleased(config, user, 'webPush')) {
        const targetUserId = user?.id || record.userId;
        if (targetUserId) {
            try {
                const result = await sendWebPushToUser(targetUserId, {
                    title: rendered.pushTitle || `${title} isn’t released yet`,
                    body: rendered.pushBody || `${releaseKind}: ${releasePretty}`,
                    href: detailPath,
                    type: 'request_not_released',
                    tag: `request-not-released-${record.id}`,
                }, { config, user, log });
                webPushSent = (result?.sent || 0) > 0;
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[RequestNotReleased] web push failed for ${record.id}: ${error?.message || error}`);
                }
            }
        }
    }

    const emailTo = user?.email || record?.meta?.requestedByEmail || null;
    if (emailTo && shouldSendNotReleased(config, user, 'email') && typeof sendEmail === 'function') {
        const uniqueKey = `request:${record.id}:not-released`;
        const dedupeUserId = user?.id || record.userId || emailTo;
        const already = typeof hasEmailBeenSent === 'function'
            ? await hasEmailBeenSent(dedupeUserId, 'request_not_released', uniqueKey)
            : false;
        if (!already) {
            try {
                const html = buildRequestAvailableEmailHtml({
                    username,
                    title,
                    year,
                    mediaType,
                    ctaUrl,
                    serverName: config?.serverName || 'StreamPilot',
                    hasLogo: true,
                    headline: rendered.emailHeadline || 'Not released yet',
                    body: rendered.emailBody
                        || `This title isn’t out yet. Expected ${releaseKind.toLowerCase()}: ${releasePretty}.`,
                    statusLabel: 'Not released yet',
                });
                const subject = rendered.emailSubject
                    || `[${config?.serverName || 'Portal'}] ${title} isn’t released yet`;
                emailSent = !!(await sendEmail(config, emailTo, subject, html));
                if (emailSent && typeof logEmailSent === 'function') {
                    await logEmailSent(dedupeUserId, 'request_not_released', uniqueKey);
                }
            } catch (error) {
                if (typeof log === 'function') {
                    log(`[RequestNotReleased] email failed for ${record.id}: ${error?.message || error}`);
                }
            }
        }
    }

    return {
        notified: emailSent || inAppCreated || webPushSent,
        email: emailSent,
        inApp: inAppCreated,
        webPush: webPushSent,
        release,
    };
};

export default notifyRequestNotReleasedYet;
