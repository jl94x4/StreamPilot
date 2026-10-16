/**
 * Notification template render + resolve (Phase 2 / #89).
 */

import {
    DEFAULT_NOTIFY_TEMPLATES,
    NOTIFY_EVENTS,
    NOTIFY_TEMPLATE_FIELDS,
} from './defaults.js';
import { arrServiceMark } from '../../arr-notify-identity.js';
import { resolveMediaType } from '../mediaMeta.js';

const TOKEN_RE = /\{([a-z_]+)\}/gi;

export const renderNotifyTemplate = (template, vars = {}) => {
    const source = template == null ? '' : String(template);
    return source.replace(TOKEN_RE, (_, key) => {
        const value = vars[key];
        if (value == null) return '';
        return String(value);
    });
};

export const buildNotifyVars = ({
    title = '',
    username = '',
    mediaType = 'movie',
    year = null,
    seasonNumber = null,
    declineReason = null,
    serverName = 'StreamPilot',
    portalUrl = '',
    status = '',
    release_date = '',
    release_type = '',
    filename = '',
    service = '',
    serviceKind = '',
} = {}) => {
    const normalizedType = resolveMediaType({ mediaType });
    const kind = normalizedType === 'tv'
        ? 'TV show'
        : (normalizedType === 'music' ? 'album/artist' : 'movie');
    const requestLabel = normalizedType === 'tv'
        ? 'New TV Show Request'
        : (normalizedType === 'music' ? 'New Music Request' : 'New Movie Request');
    const yearSuffix = year ? ` (${year})` : '';
    const season = seasonNumber != null && Number.isFinite(Number(seasonNumber))
        ? `Season ${Number(seasonNumber)}`
        : '';
    const reason = declineReason ? ` Reason: ${String(declineReason).trim()}` : '';

    return {
        title: title || 'Your request',
        user: username || 'there',
        media_type: kind,
        request_label: requestLabel,
        status: status || '',
        portal_url: portalUrl || '',
        year: yearSuffix,
        season,
        server_name: serverName || 'StreamPilot',
        decline_reason: reason,
        release_date: release_date || '',
        release_type: release_type || '',
        filename: String(filename || title || '').trim(),
        service: String(service || '').trim() || 'Scanner',
        service_mark: arrServiceMark(serviceKind, service),
    };
};

export const normalizeNotificationTemplates = (raw = {}) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const event of NOTIFY_EVENTS) {
        const incoming = raw[event];
        if (!incoming || typeof incoming !== 'object') continue;
        const fields = {};
        for (const key of NOTIFY_TEMPLATE_FIELDS) {
            if (incoming[key] == null) continue;
            const value = String(incoming[key]).trim();
            if (!value) continue;
            // Cap length to keep config small / emails sane (webhook JSON can be larger).
            const maxLen = key === 'webhookBody' ? 8000 : 2000;
            fields[key] = value.slice(0, maxLen);
        }
        if (Object.keys(fields).length) out[event] = fields;
    }
    return out;
};

/**
 * Resolve effective templates for an event (defaults ⊕ sparse config overrides).
 */
export const resolveEventTemplates = (config = {}, event = 'available') => {
    const defaults = DEFAULT_NOTIFY_TEMPLATES[event] || {};
    const overrides = config?.notificationTemplates?.[event] || {};
    const merged = { ...defaults };
    for (const key of NOTIFY_TEMPLATE_FIELDS) {
        const override = overrides[key];
        if (override != null && String(override).trim()) {
            merged[key] = String(override);
        }
    }
    return merged;
};

export const renderEventTemplates = (config, event, varsInput = {}) => {
    const templates = resolveEventTemplates(config, event);
    const vars = buildNotifyVars(varsInput);
    const rendered = {};
    for (const [key, value] of Object.entries(templates)) {
        rendered[key] = renderNotifyTemplate(value, vars);
    }
    return { templates, vars, rendered };
};

export default {
    renderNotifyTemplate,
    buildNotifyVars,
    normalizeNotificationTemplates,
    resolveEventTemplates,
    renderEventTemplates,
};
