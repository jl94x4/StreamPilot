import { fetchSpotifyToPlexJson } from './spotify-to-plex-api.js';
import { isSpotifyPortalScheduleMode } from './spotify-to-plex-schedule-mode.js';
import { isSpotifyToPlexEnabled } from './spotify-to-plex-proxy.js';

export const SPOTIFY_SYNC_SCHEDULE_CHECK_MS = 30 * 60 * 1000;
export const SPOTIFY_SYNC_MIN_INTERVAL_HOURS = 1;
export const SPOTIFY_SYNC_MAX_INTERVAL_HOURS = 168;

export const normalizeSpotifySyncIntervalHours = (value, fallback = 24) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(
        SPOTIFY_SYNC_MIN_INTERVAL_HOURS,
        Math.min(SPOTIFY_SYNC_MAX_INTERVAL_HOURS, Math.round(n)),
    );
};

export const isSpotifySyncScheduleActive = (config = {}) => (
    isSpotifyToPlexEnabled(config)
    && isSpotifyPortalScheduleMode(config)
);

export const computeNextSpotifySyncRun = (config = {}, { now = Date.now() } = {}) => {
    const hours = normalizeSpotifySyncIntervalHours(config.spotifyToPlexScheduledSyncIntervalHours, 24);
    const intervalMs = hours * 60 * 60 * 1000;
    const last = config.spotifyToPlexScheduledSyncLastRunAt
        ? Date.parse(String(config.spotifyToPlexScheduledSyncLastRunAt))
        : null;
    const base = Number.isFinite(last) ? last : now;
    return new Date(base + intervalMs).toISOString();
};

export const runSpotifySyncScheduledJob = async ({
    reason = 'scheduled',
    force = false,
    systemJob,
    markTaskStart,
    markTaskEnd,
    loadConfig,
    saveConfig,
    fetchWithTimeout,
    allowPrivate = false,
    log = () => {},
} = {}) => {
    if (!systemJob || !markTaskStart || !markTaskEnd || !loadConfig || !saveConfig || !fetchWithTimeout) {
        throw new Error('Spotify sync scheduler missing required dependencies.');
    }

    markTaskStart(systemJob);
    try {
        const config = await loadConfig();
        if (!isSpotifyToPlexEnabled(config)) {
            systemJob.nextRun = null;
            markTaskEnd(systemJob, null);
            return { skipped: true, reason: 'feature_disabled' };
        }
        if (!force && !isSpotifyPortalScheduleMode(config)) {
            systemJob.nextRun = null;
            markTaskEnd(systemJob, null);
            return { skipped: true, reason: 'schedule_disabled' };
        }

        const data = await fetchSpotifyToPlexJson({
            config,
            path: '/api/sync/all',
            method: 'POST',
            fetchWithTimeout,
            allowPrivate,
            timeoutMs: 20_000,
        });

        const nextConfig = {
            ...config,
            spotifyToPlexScheduledSyncLastRunAt: new Date().toISOString(),
        };
        await saveConfig(nextConfig);
        systemJob.nextRun = isSpotifyPortalScheduleMode(config)
            ? computeNextSpotifySyncRun(nextConfig)
            : null;
        markTaskEnd(systemJob, null);
        log(`[spotify-sync] Portal sync triggered (${reason}): ${data?.message || 'ok'}`);
        return { ok: true, data };
    } catch (error) {
        markTaskEnd(systemJob, error);
        log(`[spotify-sync] Portal sync failed (${reason}): ${error?.message || error}`);
        throw error;
    }
};
