/**
 * Generic JSON webhook publisher for request lifecycle alerts.
 */

export const DEFAULT_WEBHOOK_EVENTS = {
    available: true,
    approved: false,
    declined: false,
    season: false,
    episode: false,
    admin_pending: false,
    collexions_failed: false,
    spotify_sync_failed: false,
    scanner_failed: false,
    scanner_deleted: false,
    scanner_upgrade: false,
    scanner_import: false,
    scanner_grab: false,
    scanner_update: false,
    scanner_interaction: false,
    status_down: false,
    status_up: false,
    media_job_failed: false,
    media_job_completed: false,
    tautulli_api_failed: false,
    support_ticket: false,
    support_reply: false,
    support_media_issue: false,
};

export const normalizeWebhookEvents = (raw = {}) => ({
    ...DEFAULT_WEBHOOK_EVENTS,
    ...(raw && typeof raw === 'object' ? raw : {}),
});

export const isWebhookUrl = (url = '') => {
    try {
        const parsed = new URL(String(url || '').trim());
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

export const parseWebhookHeaders = (raw = '') => {
    const text = String(raw || '').trim();
    if (!text) return {};
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        const err = new Error('Webhook headers must be valid JSON object');
        err.code = 'WEBHOOK_HEADERS_INVALID';
        throw err;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const err = new Error('Webhook headers must be a JSON object');
        err.code = 'WEBHOOK_HEADERS_INVALID';
        throw err;
    }
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!key || value == null) continue;
        out[String(key)] = String(value);
    }
    return out;
};

export const isWebhookConfigured = (config = {}) => (
    !!config.webhookEnabled && isWebhookUrl(config.webhookUrl)
);

export const shouldSendWebhookEvent = (config = {}, event = 'available') => {
    if (!isWebhookConfigured(config)) return false;
    if (event === 'available' && config.requestAvailableNotifyEnabled === false) return false;
    const events = normalizeWebhookEvents(config.webhookEvents);
    return events[event] !== false;
};

export const buildDefaultWebhookPayload = ({
    event,
    vars = {},
    serverName = 'StreamPilot',
} = {}) => ({
    event: String(event || ''),
    server_name: serverName || vars.server_name || 'StreamPilot',
    title: vars.title || '',
    user: vars.user || '',
    media_type: vars.media_type || '',
    status: vars.status || '',
    portal_url: vars.portal_url || '',
    year: vars.year || '',
    season: vars.season || '',
    decline_reason: vars.decline_reason || '',
    timestamp: new Date().toISOString(),
});

export const sendGenericWebhook = async ({
    config,
    event,
    vars = {},
    renderedBody = '',
    fetchImpl = fetch,
    log = () => {},
} = {}) => {
    if (!shouldSendWebhookEvent(config, event)) return false;
    const url = String(config.webhookUrl || '').trim();
    if (!isWebhookUrl(url)) return false;

    let headers = { 'Content-Type': 'application/json' };
    try {
        headers = { ...headers, ...parseWebhookHeaders(config.webhookHeadersJson) };
    } catch (error) {
        if (typeof log === 'function') {
            log(`[Webhook] headers invalid: ${error?.message || error}`);
        }
        return false;
    }

    let body;
    const template = String(renderedBody || '').trim();
    if (template) {
        try {
            // Template must render to JSON object/array.
            body = JSON.parse(template);
        } catch (error) {
            if (typeof log === 'function') {
                log(`[Webhook] template JSON invalid for ${event}: ${error?.message || error}`);
            }
            return false;
        }
    } else {
        body = buildDefaultWebhookPayload({
            event,
            vars,
            serverName: config?.serverName || 'StreamPilot',
        });
    }

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            if (typeof log === 'function') {
                log(`[Webhook] ${response.status}: ${detail.slice(0, 200)}`);
            }
            return false;
        }
        return true;
    } catch (error) {
        if (typeof log === 'function') {
            log(`[Webhook] failed: ${error?.message || error}`);
        }
        return false;
    }
};

export default sendGenericWebhook;
