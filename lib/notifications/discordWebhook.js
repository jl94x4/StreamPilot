/**
 * Discord incoming webhook posts for request-available alerts.
 */

const isDiscordWebhookUrl = (url = '') => {
    try {
        const parsed = new URL(String(url || '').trim());
        if (!['https:', 'http:'].includes(parsed.protocol)) return false;
        return /(^|\.)discord(?:app)?\.com$/i.test(parsed.hostname)
            && parsed.pathname.includes('/api/webhooks/');
    } catch {
        return false;
    }
};

export const shouldSendRequestAvailableDiscord = (config = {}, user = null) => {
    if (config.requestAvailableNotifyEnabled === false) return false;
    if (config.requestAvailableNotifyDiscord === false) return false;
    if (user?.notifyRequestAvailableDiscord === false) return false;
    return isDiscordWebhookUrl(config.requestAvailableDiscordWebhookUrl);
};

export const buildRequestAvailableDiscordPayload = ({
    username,
    title,
    year,
    mediaType,
    ctaUrl,
    serverName,
    rendered = null,
} = {}) => {
    const kind = mediaType === 'tv' ? 'TV show' : (mediaType === 'music' ? 'album/artist' : 'movie');
    const yearSuffix = year ? ` (${year})` : '';
    const requester = username || 'Someone';
    const content = rendered?.discordContent
        || (`**${title || 'A request'}${yearSuffix}** is now available`
            + (requester ? ` — requested by **${requester}**` : '')
            + `.`);

    return {
        username: String(serverName || 'StreamPilot').slice(0, 80) || 'StreamPilot',
        content,
        embeds: [{
            title: rendered?.discordEmbedTitle || `${title || 'Request'}${yearSuffix}`,
            description: rendered?.discordEmbedDescription || `The ${kind} is ready to watch.`,
            color: 0xe5a00d,
            fields: [
                ...(requester ? [{ name: 'Requester', value: String(requester).slice(0, 256), inline: true }] : []),
                { name: 'Status', value: 'Available', inline: true },
            ],
            ...(ctaUrl ? { url: String(ctaUrl) } : {}),
            timestamp: new Date().toISOString(),
        }],
        allowed_mentions: { parse: [] },
    };
};

export const sendDiscordWebhook = async (webhookUrl, payload, { fetchImpl = fetch, log = () => {} } = {}) => {
    if (!isDiscordWebhookUrl(webhookUrl)) return false;
    try {
        const response = await fetchImpl(String(webhookUrl).trim(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            if (typeof log === 'function') {
                log(`[DiscordWebhook] ${response.status}: ${detail.slice(0, 200)}`);
            }
            return false;
        }
        return true;
    } catch (error) {
        if (typeof log === 'function') {
            log(`[DiscordWebhook] failed: ${error?.message || error}`);
        }
        return false;
    }
};

export const notifyRequestAvailableDiscord = async ({
    config,
    user,
    username,
    title,
    year,
    mediaType,
    ctaUrl,
    rendered = null,
    fetchImpl = fetch,
    log = () => {},
} = {}) => {
    if (!shouldSendRequestAvailableDiscord(config, user)) return false;
    const payload = buildRequestAvailableDiscordPayload({
        username,
        title,
        year,
        mediaType,
        ctaUrl,
        serverName: config?.serverName || 'StreamPilot',
        rendered,
    });
    return sendDiscordWebhook(config.requestAvailableDiscordWebhookUrl, payload, { fetchImpl, log });
};

export default notifyRequestAvailableDiscord;
