import { isSpotifyToPlexEnabled, sanitizeSpotifyToPlexProxyBase } from './spotify-to-plex-proxy.js';

const SYNC_TYPES = ['albums', 'playlists', 'users', 'lidarr', 'mqtt', 'slskd', 'all'];

export const SPOTIFY_TO_PLEX_SYNC_TYPES = SYNC_TYPES;

export const resolveSpotifyToPlexBase = (config, { allowPrivate = false } = {}) => {
    if (!isSpotifyToPlexEnabled(config)) return '';
    return sanitizeSpotifyToPlexProxyBase(config.spotifyToPlexInternalUrl, { allowPrivate });
};

export const fetchSpotifyToPlexJson = async ({
    config,
    path,
    method = 'GET',
    body,
    fetchWithTimeout,
    allowPrivate = false,
    timeoutMs = 15000,
} = {}) => {
    const base = resolveSpotifyToPlexBase(config, { allowPrivate });
    if (!base) throw new Error('Spotify Sync is not configured.');
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    const url = `${base}${normalizedPath}`;
    const headers = { Accept: 'application/json' };
    const init = { method: String(method || 'GET').toUpperCase(), headers };
    if (body != null && init.method !== 'GET' && init.method !== 'HEAD') {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const upstream = await fetchWithTimeout(url, init, timeoutMs);
    const text = await upstream.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { raw: text };
        }
    }
    if (!upstream.ok) {
        const message = data?.error || data?.message || data?.msg || `Spotify Sync worker HTTP ${upstream.status}`;
        const err = new Error(message);
        err.status = upstream.status;
        err.data = data;
        throw err;
    }
    return data;
};

export const SPOTIFY_TO_PLEX_LOG_TYPES = ['playlists', 'albums', 'users', 'lidarr', 'mqtt', 'slskd'];

const lastSyncLogEntry = (entries) => {
    if (!Array.isArray(entries) || !entries.length) return null;
    return entries[entries.length - 1];
};

const entryTimestamp = (entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const raw = entry.finishedAt || entry.finished_at || entry.timestamp || entry.date || entry.startedAt;
    const parsed = Date.parse(String(raw || ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const entryFailed = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.success === false || entry.ok === false) return true;
    if (entry.error) return true;
    const status = String(entry.status || '').toLowerCase();
    return status.includes('fail') || status.includes('error');
};

const timestampFromSyncValue = (value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value > 0 && value < 1e12 ? value * 1000 : value;
        return new Date(ms).toISOString();
    }
    if (typeof value === 'object') {
        return timestampFromSyncValue(value.end || value.finishedAt || value.timestamp || value.start || value.date);
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const typeLogToEntry = (type, value) => {
    if (value == null || value === '') return null;
    if (typeof value === 'object') {
        const finishedAt = value.end || value.finishedAt || value.finished_at || value.timestamp || value.date;
        const startedAt = value.start || value.startedAt || value.started_at;
        const status = value.status || (entryFailed(value) ? 'error' : 'success');
        return {
            message: String(value.message || value.error || `${type} sync`),
            status,
            success: value.success ?? value.ok ?? !entryFailed(value),
            startedAt,
            finishedAt: finishedAt || startedAt,
            error: value.error || undefined,
        };
    }
    return {
        message: `${type} sync`,
        status: 'success',
        success: true,
        finishedAt: value,
    };
};

const playlistJobToEntry = (job) => {
    if (!job || typeof job !== 'object') return null;
    const ok = job.ok !== false && job.status !== 'error';
    return {
        id: job.id,
        message: String(job.message || (job.status === 'running' ? 'Syncing to Plex' : 'Playlist sync')),
        status: job.status || (ok ? 'success' : 'error'),
        success: job.status === 'running' ? null : ok,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        done: job.done,
        total: job.total,
        error: ok || job.status === 'running' ? undefined : job.message,
    };
};

export const hydrateSpotifyToPlexSyncLog = (logs = {}) => {
    const syncLog = { ...(logs.sync_log || {}) };
    const syncTypeLog = logs.sync_type_log || {};
    for (const type of SPOTIFY_TO_PLEX_LOG_TYPES) {
        const entries = Array.isArray(syncLog[type]) ? [...syncLog[type]] : [];
        if (!entries.length) {
            const synthetic = typeLogToEntry(type, syncTypeLog[type]);
            if (synthetic) entries.push(synthetic);
        }
        syncLog[type] = entries;
    }
    return { ...logs, sync_log: syncLog };
};

export const buildSpotifyToPlexLogsView = (logs = {}, playlistJobs = []) => {
    const hydrated = hydrateSpotifyToPlexSyncLog(logs);
    const portalEntries = (Array.isArray(playlistJobs) ? playlistJobs : [])
        .map(playlistJobToEntry)
        .filter(Boolean);
    return {
        ...hydrated,
        sync_log: {
            ...hydrated.sync_log,
            playlists: [...portalEntries, ...(hydrated.sync_log.playlists || [])],
        },
    };
};

export const summarizeSpotifyToPlexLogs = (logs = {}, { playlistJobs = [] } = {}) => {
    const view = buildSpotifyToPlexLogsView(logs, playlistJobs);
    const syncTypeLog = logs.sync_type_log || {};
    const lastSync = {};
    for (const type of SPOTIFY_TO_PLEX_LOG_TYPES) {
        lastSync[type] = timestampFromSyncValue(syncTypeLog[type])
            || timestampFromSyncValue(lastSyncLogEntry(view.sync_log[type]));
    }
    const portalLatest = (Array.isArray(playlistJobs) ? playlistJobs : [])
        .map((job) => timestampFromSyncValue(job?.finishedAt || job?.startedAt))
        .filter(Boolean)
        .sort()
        .at(-1);
    if (portalLatest && (!lastSync.playlists || portalLatest > lastSync.playlists)) {
        lastSync.playlists = portalLatest;
    }
    const workerRuns = Array.isArray(logs?.sync_log?.playlists) ? logs.sync_log.playlists.length : 0;
    const typeLogRuns = !workerRuns && timestampFromSyncValue(syncTypeLog.playlists) ? 1 : 0;
    const portalRuns = Array.isArray(playlistJobs) ? playlistJobs.length : 0;
    return {
        lastSync,
        playlistRunCount: workerRuns + typeLogRuns + portalRuns,
    };
};

export const detectSpotifyToPlexSyncFailure = (logs = {}, { now = Date.now(), maxAgeMs = 48 * 3600 * 1000 } = {}) => {
    const syncLog = logs.sync_log || {};
    const failures = [];
    for (const [type, entries] of Object.entries(syncLog)) {
        const last = lastSyncLogEntry(entries);
        if (!last || !entryFailed(last)) continue;
        const at = entryTimestamp(last);
        if (at && (now - at) > maxAgeMs) continue;
        failures.push({
            type,
            message: String(last.error || last.message || last.status || 'Sync failed'),
            at: last.finishedAt || last.finished_at || last.timestamp || last.date || null,
        });
    }
    if (!failures.length) return null;
    return {
        failures,
        signature: failures.map((f) => `${f.type}:${f.message}:${f.at || ''}`).join('|'),
    };
};

export const buildSpotifyToPlexPortalApplyPlan = (config, {
    resolveConfiguredPlexServerUrl,
    getArrInstances,
    isArrInstanceReady,
} = {}) => {
    const plexUrl = String(resolveConfiguredPlexServerUrl?.(config) || '').trim().replace(/\/+$/, '');
    const plexToken = String(config.plexToken || '').trim();
    const serverId = String(config.serverIdentifier || '').trim();
    const lidarr = getArrInstances?.(config, { type: 'lidarr', enabledOnly: true }).find(isArrInstanceReady);
    return {
        plex: plexUrl && plexToken
            ? { uri: plexUrl, serverToken: plexToken, id: serverId || undefined }
            : null,
        lidarr: lidarr?.url && lidarr?.apiKey
            ? { url: String(lidarr.url).trim().replace(/\/+$/, ''), apiKey: String(lidarr.apiKey).trim() }
            : null,
    };
};
