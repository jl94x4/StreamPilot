/**
 * ntfy.sh / self-hosted ntfy publisher for request lifecycle alerts.
 */

const clampPriority = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(5, Math.round(n)));
};

export const DEFAULT_NTFY_EVENTS = {
    available: true,
    approved: true,
    declined: true,
    season: true,
    episode: false,
    admin_pending: true,
    collexions_failed: true,
    spotify_sync_failed: true,
    scanner_failed: true,
    scanner_deleted: true,
    scanner_upgrade: true,
    scanner_import: true,
    scanner_grab: true,
    scanner_update: true,
    scanner_interaction: true,
    status_down: true,
    status_up: true,
    media_job_failed: true,
    media_job_completed: false,
    tautulli_api_failed: true,
    support_ticket: true,
    support_reply: true,
    support_media_issue: true,
};

export const normalizeNtfyEvents = (raw = {}) => ({
    ...DEFAULT_NTFY_EVENTS,
    ...(raw && typeof raw === 'object' ? raw : {}),
});

export const isNtfyConfigured = (config = {}) => {
    const url = String(config.ntfyServerUrl || '').trim();
    const topic = String(config.ntfyTopic || '').trim();
    return !!(config.ntfyEnabled && url && topic);
};

export const shouldSendNtfyEvent = (config = {}, event = 'available') => {
    if (!isNtfyConfigured(config)) return false;
    if (event === 'available' && config.requestAvailableNotifyEnabled === false) return false;
    const events = normalizeNtfyEvents(config.ntfyEvents);
    return events[event] !== false;
};

export const buildNtfyPublishUrl = (config = {}) => {
    const base = String(config.ntfyServerUrl || '').replace(/\/+$/, '');
    const topic = String(config.ntfyTopic || '').replace(/^\/+|\/+$/g, '');
    if (!base || !topic) return '';
    return `${base}/${encodeURIComponent(topic).replace(/%2F/gi, '/')}`;
};

export const sendNtfyMessage = async ({
    config,
    title,
    body,
    priority,
    tags = '',
    clickUrl = '',
    attachUrl = '',
    fetchImpl = fetch,
    log = () => {},
} = {}) => {
    if (!isNtfyConfigured(config)) return false;
    const url = buildNtfyPublishUrl(config);
    if (!url) return false;

    const headers = {
        Title: String(title || 'StreamPilot').slice(0, 250),
        Priority: String(clampPriority(priority ?? config.ntfyPriority ?? 3)),
        'Content-Type': 'text/plain; charset=utf-8',
    };
    const token = String(config.ntfyToken || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tags) headers.Tags = String(tags).slice(0, 120);
    if (clickUrl) headers.Click = String(clickUrl).slice(0, 2000);
    const attach = String(attachUrl || '').trim();
    if (/^https?:\/\//i.test(attach)) {
        headers.Attach = attach.slice(0, 2000);
        headers.Icon = attach.slice(0, 2000);
    }

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers,
            body: String(body || ''),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            if (typeof log === 'function') {
                log(`[ntfy] ${response.status}: ${detail.slice(0, 200)}`);
            }
            return false;
        }
        return true;
    } catch (error) {
        if (typeof log === 'function') {
            log(`[ntfy] failed: ${error?.message || error}`);
        }
        return false;
    }
};

export const notifyNtfyEvent = async ({
    config,
    event,
    title,
    body,
    clickUrl = '',
    tags = '',
    attachUrl = '',
    fetchImpl = fetch,
    log = () => {},
} = {}) => {
    if (!shouldSendNtfyEvent(config, event)) return false;
    const defaultTags = event === 'admin_pending'
        ? 'inbox_tray'
        : (String(event || '').startsWith('support_')
            ? 'ticket'
            : (String(event || '').includes('fail') || String(event || '').endsWith('_down')
                ? 'warning'
                : 'movie_camera'));
    return sendNtfyMessage({
        config,
        title,
        body,
        clickUrl,
        tags: tags || defaultTags,
        attachUrl,
        fetchImpl,
        log,
    });
};

export default notifyNtfyEvent;
