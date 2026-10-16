/**
 * Preview / test-send helpers for automated email templates.
 */

import { normalizeEmailTemplates } from './render.js';
import {
    buildExpiryWarningEmail,
    buildAccessExpiredEmail,
    buildAccessAdjustedEmail,
    buildInviteEmail,
    buildAnnouncementEmail,
    buildWelcomeEmail,
} from './buildHtml.js';

const SAMPLE = {
    expiry_warning: {
        username: 'Alex',
        days: 3,
        expiryDate: 'September 5, 2026',
        serverName: 'Demo Server',
        contactUrl: 'https://example.com/help',
    },
    access_expired: {
        username: 'Alex',
        expiryDate: 'September 1, 2026',
        serverName: 'Demo Server',
    },
    access_adjusted: {
        username: 'Alex',
        expiryDateLabel: 'December 31, 2026',
        days: 90,
        serverName: 'Demo Server',
    },
    invite: {
        serverName: 'Demo Server',
        inviteUrl: 'https://portal.example/invite/preview-code',
        durationDays: 30,
    },
    announcement: {
        serverName: 'Demo Server',
        announcementText: 'Library maintenance is scheduled for Sunday at 02:00. Expect brief downtime.',
    },
    welcome: {
        username: 'Alex',
        serverName: 'Demo Server',
        portalUrl: 'https://portal.example',
    },
    newsletter: null,
};

export const mergeEmailTemplateDraft = (config = {}, event = '', draftFields = {}) => {
    const normalizedDraft = normalizeEmailTemplates({
        ...(config.emailTemplates || {}),
        [event]: draftFields,
    });
    return {
        ...config,
        emailTemplates: normalizedDraft,
    };
};

export const buildAutomatedEmailPreview = (config = {}, event = '', draftFields = {}) => {
    const merged = mergeEmailTemplateDraft(config, event, draftFields);
    const sample = SAMPLE[event];
    if (!sample) {
        return { subject: '', html: '', event, unsupported: true };
    }

    switch (event) {
        case 'expiry_warning':
            return buildExpiryWarningEmail({ config: merged, ...sample });
        case 'access_expired':
            return buildAccessExpiredEmail({ config: merged, ...sample });
        case 'access_adjusted':
            return buildAccessAdjustedEmail({ config: merged, ...sample });
        case 'invite':
            return buildInviteEmail({ config: merged, ...sample });
        case 'announcement':
            return buildAnnouncementEmail({ config: merged, ...sample });
        case 'welcome':
            return buildWelcomeEmail({ config: merged, ...sample });
        default:
            return { subject: '', html: '', event, unsupported: true };
    }
};

export default {
    mergeEmailTemplateDraft,
    buildAutomatedEmailPreview,
};
