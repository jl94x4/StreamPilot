/** Pure Live TV / DVR mappers. Keep in sync with client/plex-client livetv handlers. */

/**
 * Query strings to try for `{epg}/grid`, in order: PMS filter syntax first (what Plex's own
 * clients send), then looser forms. The first that returns airings wins.
 */
export const liveTvGridQueries = (startsAt, endsAt) => [
    `type=1,4&sort=beginsAt&endsAt>=${startsAt}&beginsAt<=${endsAt}`,
    `type=1,4&sort=beginsAt&endsAt>>=${startsAt}&beginsAt<<=${endsAt}`,
    `type=1,4&sort=beginsAt`,
    `startsAt=${startsAt}&endsAt=${endsAt}`,
];

/** True when a mapped guide has any airing inside the window. */
export const guideHasAirings = (rows, startsAt, endsAt) => (rows || []).some((row) => (
    (row.airings || []).some((airing) => airing.liveStartsAt < endsAt && (airing.liveEndsAt || airing.liveStartsAt) > startsAt)
));

/** Keep only airings that overlap [startsAt, endsAt) (an unfiltered grid can be the whole EPG). */
export const clipGuideWindow = (rows, startsAt, endsAt) => (rows || []).map((row) => ({
    ...row,
    airings: (row.airings || []).filter((airing) => (
        airing.liveStartsAt < endsAt && (airing.liveEndsAt || airing.liveStartsAt + 1) > startsAt
    )),
}));

export const LIVE_AIRING_TYPE = 'liveAiring';

const asList = (value) => {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
};

const containerOf = (data) => data?.MediaContainer || data || {};

export const unixSeconds = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
};

export const liveTvGuideWindow = (nowMs = Date.now(), hours = 4) => {
    const now = Math.floor(Number(nowMs) || Date.now());
    // Start on the current half hour (01:02 -> 01:00), like Plex's guide.
    const start = Math.floor(Math.floor(now / 1000) / 1800) * 1800;
    const span = Math.max(1, Math.min(12, Number(hours) || 4)) * 3600;
    return { startsAt: start, endsAt: start + span };
};

export const epgPrefixFromLineup = (lineup) => {
    const raw = String(lineup || '').trim();
    const match = raw.match(/tv\.plex\.providers\.epg\.[^/:]+(?::[^/]+)?/i);
    if (match) return `/${match[0].replace(/\/+$/, '')}`;
    return '';
};

export const epgPrefixFromProviders = (data) => {
    const providers = asList(containerOf(data).MediaProvider);
    for (const provider of providers) {
        const id = String(provider.identifier || provider.id || '');
        if (!/tv\.plex\.providers\.epg/i.test(id)) continue;
        const features = asList(provider.Feature);
        for (const feature of features) {
            const key = String(feature.key || '');
            const grid = key.match(/^(\/tv\.plex\.providers\.epg\.[^/]+)/i);
            if (grid) return grid[1];
        }
        if (id) return `/${id}`;
    }
    return '';
};

/** Every EPG provider prefix PMS lists (`/tv.plex.providers.epg.xmltv:41`), in its order. */
export const epgPrefixesFromProviders = (data) => {
    const out = [];
    const push = (value) => {
        const prefix = String(value || '').replace(/\/+$/, '');
        if (prefix && !out.includes(prefix)) out.push(prefix);
    };
    for (const provider of asList(containerOf(data).MediaProvider)) {
        const id = String(provider.identifier || provider.id || '');
        const isEpg = /tv\.plex\.providers\.epg/i.test(id);
        for (const feature of asList(provider.Feature)) {
            const key = String(feature.key || '');
            const match = key.match(/^(\/tv\.plex\.providers\.epg\.[^/]+)/i);
            if (match) push(match[1]);
        }
        if (isEpg) {
            // A bare identifier without the ":<n>" suffix is not addressable; use the provider key.
            if (/:/.test(id)) push(`/${id}`);
            const key = String(provider.key || '');
            if (/^\/tv\.plex\.providers\.epg\./i.test(key)) push(key.split('?')[0]);
        }
    }
    return out;
};

/**
 * Guide addresses to try for one DVR, best first: the providers PMS lists, then the
 * `<type>:<dvrId>` form PMS uses for a DVR's guide, then the lineup's bare prefix.
 */
export const epgPrefixCandidates = (dvr, providerPrefixes = []) => {
    const out = [];
    const push = (value) => {
        const prefix = String(value || '').replace(/\/+$/, '');
        if (prefix && !out.includes(prefix)) out.push(prefix);
    };
    const lineupType = (String(dvr?.lineup || '').match(/tv\.plex\.providers\.epg\.([a-z0-9_-]+)/i) || [])[1];
    const matching = providerPrefixes.filter((prefix) => (
        !lineupType || prefix.toLowerCase().includes(`epg.${lineupType.toLowerCase()}`)
    ));
    // A provider whose number is this DVR's key is its guide.
    providerPrefixes.filter((prefix) => dvr?.id && prefix.endsWith(`:${dvr.id}`)).forEach(push);
    matching.forEach(push);
    if (lineupType && dvr?.id) push(`/tv.plex.providers.epg.${lineupType}:${dvr.id}`);
    providerPrefixes.forEach(push);
    if (dvr?.epgPrefix) push(dvr.epgPrefix);
    return out;
};

export const mapLiveTvDvr = (raw, server) => {
    const key = String(raw?.key || raw?.uuid || '').trim();
    if (!key) return null;
    const devices = asList(raw.Device);
    const mappings = devices.flatMap((device) => asList(device.ChannelMapping));
    return {
        id: key,
        serverId: String(server?.id || ''),
        serverName: String(server?.name || ''),
        uuid: String(raw.uuid || ''),
        lineup: String(raw.lineup || ''),
        language: String(raw.language || ''),
        tuners: Number(devices[0]?.tuners || 0) || null,
        make: String(devices[0]?.make || ''),
        model: String(devices[0]?.model || ''),
        epgPrefix: epgPrefixFromLineup(raw.lineup),
        channelMappings: mappings.map((row) => ({
            channelKey: String(row.channelKey || row.key || ''),
            deviceIdentifier: String(row.deviceIdentifier || row.channelIdentifier || ''),
            enabled: row.enabled !== '0' && row.enabled !== 0 && row.enabled !== false,
        })).filter((row) => row.deviceIdentifier || row.channelKey),
    };
};

export const mapLiveTvDvrs = (data, server) => (
    asList(containerOf(data).Dvr || containerOf(data).DVR)
        .map((row) => mapLiveTvDvr(row, server))
        .filter(Boolean)
);

const channelThumb = (raw) => (
    String(raw?.thumb || raw?.art || raw?.poster || raw?.composite || '').trim() || null
);

export const mapLiveTvChannel = (raw, extras = {}) => {
    const number = String(raw?.channelIdentifier || raw?.identifier || raw?.number || raw?.channelNumber || extras.deviceIdentifier || '').trim();
    const key = String(raw?.key || raw?.ratingKey || extras.channelKey || number).trim();
    const title = String(raw?.title || raw?.tag || raw?.callSign || raw?.name || '').trim();
    if (!key && !number) return null;
    return {
        id: key || number,
        channelKey: key || number,
        number,
        callSign: String(raw?.callSign || raw?.shortTitle || '').trim() || title,
        title: title || number,
        thumb: channelThumb(raw),
        hd: raw?.hd === 1 || raw?.hd === true || /hd/i.test(String(raw?.title || '')),
        dvrId: String(extras.dvrId || ''),
        serverId: String(extras.serverId || ''),
        enabled: extras.enabled !== false,
    };
};

export const mapLiveTvChannels = (data, extras = {}) => {
    const root = containerOf(data);
    const rows = asList(root.Channel || root.Directory || root.Metadata);
    const mapped = rows.map((row) => mapLiveTvChannel(row, extras)).filter(Boolean);
    if (mapped.length) return mapped;
    return (extras.channelMappings || [])
        .filter((row) => row.enabled !== false)
        .map((row) => mapLiveTvChannel({ identifier: row.deviceIdentifier, key: row.channelKey }, extras))
        .filter(Boolean);
};

export const mapLiveTvAiring = (raw, channel, extras = {}) => {
    const startsAt = unixSeconds(raw?.beginsAt || raw?.startTimeOffset);
    const endsAt = unixSeconds(raw?.endsAt || raw?.endTimeOffset) || (startsAt ? startsAt + 1800 : 0);
    const title = String(raw?.grandparentTitle || raw?.title || channel?.title || 'Live').trim();
    const episode = String(raw?.title && raw?.grandparentTitle ? raw.title : '').trim();
    const ratingKey = String(raw?.ratingKey || raw?.key || `${channel?.id || 'ch'}:${startsAt}`).trim();
    return {
        ratingKey,
        title: episode && title !== episode ? title : (title || episode || channel?.callSign || 'Live'),
        showTitle: episode && title !== episode ? title : (channel?.title || null),
        episodeTitle: episode && title !== episode ? episode : null,
        type: LIVE_AIRING_TYPE,
        summary: String(raw?.summary || raw?.tagline || '').trim(),
        thumb: channelThumb(raw) || channel?.thumb || null,
        art: String(raw?.art || raw?.grandparentArt || '').trim() || null,
        year: raw?.year ? Number(raw.year) : null,
        durationMs: startsAt && endsAt ? Math.max(0, (endsAt - startsAt) * 1000) : null,
        viewOffsetMs: 0,
        canPlay: true,
        serverId: String(extras.serverId || channel?.serverId || ''),
        liveChannelId: String(channel?.id || extras.channelId || ''),
        liveChannelNumber: String(channel?.number || ''),
        liveChannelTitle: String(channel?.title || channel?.callSign || ''),
        liveDvrId: String(channel?.dvrId || extras.dvrId || ''),
        liveStartsAt: startsAt,
        liveEndsAt: endsAt,
    };
};

/**
 * PMS `{epg}/grid` answers with a flat list of airings (Metadata, type 1 movie / 4 episode).
 * Each airing's Media entry is one showing: beginsAt / endsAt plus the channel it is on
 * (channelIdentifier, channelVcn, channelTitle, channelCallSign, channelThumb).
 */
const isFlatGrid = (rows) => rows.some((row) => asList(row?.Media).some((media) => (
    media && (media.beginsAt != null || media.channelIdentifier != null || media.channelVcn != null)
)));

const channelKeysOf = (channel) => [
    channel.id, channel.channelKey, channel.number, channel.identifier, channel.callSign, channel.title,
].filter(Boolean).map((key) => String(key).trim().toLowerCase());

const mediaChannelKeys = (media) => [
    media.channelIdentifier, media.channelVcn, media.channelCallSign, media.channelShortTitle, media.channelTitle,
].filter((key) => key != null && String(key).trim()).map((key) => String(key).trim().toLowerCase());

export const mapLiveTvGridFlat = (rows, channels, extras = {}) => {
    const known = new Map();
    for (const channel of channels || []) {
        for (const key of channelKeysOf(channel)) if (!known.has(key)) known.set(key, channel);
    }
    const byChannel = new Map();
    const order = [];
    for (const raw of rows) {
        for (const media of asList(raw?.Media)) {
            if (!media) continue;
            const keys = mediaChannelKeys(media);
            const base = keys.map((key) => known.get(key)).find(Boolean) || null;
            const identifier = String(media.channelIdentifier || media.channelVcn || base?.number || '').trim();
            const id = String(base?.id || identifier || keys[0] || '').trim();
            if (!id) continue;
            if (!byChannel.has(id)) {
                // Fill the channel's name / logo from the guide (the DVR mapping only has numbers).
                const channel = {
                    ...(base || mapLiveTvChannel({ identifier, key: identifier }, extras) || {}),
                    id,
                    channelKey: base?.channelKey || identifier || id,
                    number: String(media.channelVcn || base?.number || identifier || '').trim(),
                    identifier,
                    title: String(media.channelTitle || base?.title || media.channelCallSign || identifier).trim(),
                    callSign: String(media.channelCallSign || media.channelShortTitle || base?.callSign || '').trim(),
                    thumb: String(media.channelThumb || '').trim() || base?.thumb || null,
                    dvrId: String(base?.dvrId || extras.dvrId || ''),
                    serverId: String(base?.serverId || extras.serverId || ''),
                };
                byChannel.set(id, { channel, airings: [] });
                order.push(id);
            }
            const row = byChannel.get(id);
            const airing = mapLiveTvAiring({
                ...raw,
                beginsAt: media.beginsAt ?? raw.beginsAt,
                endsAt: media.endsAt ?? raw.endsAt,
                ratingKey: `${raw.ratingKey || raw.key || raw.title}:${id}:${media.beginsAt ?? ''}`,
            }, row.channel, extras);
            if (!airing.liveStartsAt) continue;
            // Tune with the identifier PMS reports for this channel.
            airing.liveChannelId = identifier || row.channel.id;
            row.airings.push(airing);
        }
    }
    // Keep every known channel (even with nothing in the window), in channel-number order.
    for (const channel of channels || []) {
        if (![...byChannel.values()].some((row) => channelKeysOf(row.channel).some((key) => channelKeysOf(channel).includes(key)))) {
            byChannel.set(String(channel.id), { channel, airings: [] });
            order.push(String(channel.id));
        }
    }
    const out = order.map((id) => byChannel.get(id)).filter(Boolean);
    for (const row of out) row.airings.sort((a, b) => a.liveStartsAt - b.liveStartsAt);
    out.sort((a, b) => String(a.channel.number || a.channel.title).localeCompare(String(b.channel.number || b.channel.title), undefined, { numeric: true }));
    return out;
};

export const mapLiveTvGuide = (data, channels, extras = {}) => {
    const flatRows = asList(containerOf(data).Metadata);
    if (flatRows.length && isFlatGrid(flatRows)) return mapLiveTvGridFlat(flatRows, channels, extras);
    const byId = new Map();
    for (const channel of channels || []) {
        const keys = [channel.id, channel.channelKey, channel.number].filter(Boolean);
        for (const key of keys) byId.set(String(key), channel);
    }
    const rows = asList(containerOf(data).Channel || containerOf(data).Metadata);
    const out = [];
    const seen = new Set();
    for (const row of rows) {
        const channel = byId.get(String(row.key || row.ratingKey || row.identifier || row.channelIdentifier || ''))
            || mapLiveTvChannel(row, extras);
        if (!channel) continue;
        const airings = asList(row.Video || row.Metadata || row.Grabber)
            .map((airing) => mapLiveTvAiring(airing, channel, extras))
            .filter((airing) => airing.liveStartsAt);
        const id = channel.id;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ channel, airings });
    }
    if (out.length) return out;
    return (channels || []).map((channel) => ({ channel, airings: [] }));
};

export const onNowFromGuide = (guide, nowSec = Math.floor(Date.now() / 1000)) => {
    const items = [];
    for (const row of guide || []) {
        const current = (row.airings || []).find((airing) => (
            airing.liveStartsAt <= nowSec && (!airing.liveEndsAt || airing.liveEndsAt > nowSec)
        ));
        if (current) items.push(current);
    }
    return items;
};

/** Depth-first: the first object (or the root) for which `match` is true. */
const findDeep = (value, match, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return null;
    if (!Array.isArray(value) && match(value)) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        const hit = findDeep(child, match, depth + 1);
        if (hit) return hit;
    }
    return null;
};

export const parseLiveTvTune = (data) => {
    const root = containerOf(data);
    // PMS nests the stream: MediaSubscription > MediaGrabOperation > Metadata (Video) > Media > Part.
    const meta = findDeep(root, (node) => asList(node.Media).some((media) => asList(media?.Part).length))
        || asList(root.Metadata || root.Video)[0]
        || root;
    const media = asList(meta.Media)[0] || {};
    const part = asList(media.Part)[0] || findDeep(root, (node) => /\/livetv\/sessions\//.test(String(node.key || ''))) || {};
    const sessionFromKey = (String(part.key || meta.key || '').match(/\/livetv\/sessions\/([^/?]+)/) || [])[1] || '';
    const sessionId = String(
        sessionFromKey || root.session || meta.session || media.session || part.session || meta.ratingKey || '',
    ).trim();
    const ratingKey = String(meta.ratingKey || '').trim();
    const path = String(meta.key || part.key || '').trim();
    return {
        sessionId: sessionId || ratingKey,
        ratingKey,
        path,
        partKey: String(part.key || '').trim(),
        durationMs: Number(meta.duration || media.duration || 0) || 0,
        media,
        part,
        meta,
    };
};

export const livePlaybackPath = (tune) => {
    if (!tune) return '';
    if (tune.partKey && (tune.partKey.startsWith('/') || /^https?:/i.test(tune.partKey))) return tune.partKey;
    if (tune.path && (tune.path.startsWith('/library/') || tune.path.startsWith('/livetv/'))) return tune.path;
    if (tune.ratingKey) return `/library/metadata/${tune.ratingKey}`;
    if (tune.sessionId) return `/livetv/sessions/${encodeURIComponent(tune.sessionId)}`;
    return '';
};

export const airingProgressMs = (airing, nowMs = Date.now()) => {
    const start = Number(airing?.liveStartsAt || 0) * 1000;
    const end = Number(airing?.liveEndsAt || 0) * 1000;
    if (!start || !end || end <= start) return 0;
    return Math.max(0, Math.min(end - start, nowMs - start));
};
