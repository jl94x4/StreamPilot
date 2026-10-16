export const SPOTIFY_TO_PLEX_SCHEDULE_MODES = ['sidecar', 'portal'];

export const normalizeSpotifyToPlexScheduleMode = (value, fallback = 'sidecar') => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'portal') return 'portal';
    if (raw === 'sidecar') return 'sidecar';
    return fallback === 'portal' ? 'portal' : 'sidecar';
};

/** Resolve schedule mode from config, including legacy scheduledSyncEnabled flag. */
export const resolveSpotifyToPlexScheduleMode = (config = {}) => {
    if (config.spotifyToPlexScheduleMode) {
        return normalizeSpotifyToPlexScheduleMode(config.spotifyToPlexScheduleMode, 'sidecar');
    }
    if (config.spotifyToPlexScheduledSyncEnabled) return 'portal';
    return 'sidecar';
};

export const isSpotifyPortalScheduleMode = (config = {}) => (
    resolveSpotifyToPlexScheduleMode(config) === 'portal'
);
