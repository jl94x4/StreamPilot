/**
 * Poll spotify-to-plex logs API for recent sync failures and notify admins once per signature.
 */

import { detectSpotifyToPlexSyncFailure, fetchSpotifyToPlexJson } from './spotify-to-plex-api.js';
import { isSpotifyToPlexEnabled } from './spotify-to-plex-proxy.js';

let timer = null;
let lastFailureSignature = '';
let onFailure = null;

export const setSpotifyToPlexFailureNotify = (fn) => {
    onFailure = typeof fn === 'function' ? fn : null;
};

export const resetSpotifyToPlexStatusWatchForTests = () => {
    lastFailureSignature = '';
};

export const pollSpotifyToPlexStatusOnce = async ({
    config,
    enabled = true,
    fetchWithTimeout,
    allowPrivate = false,
} = {}) => {
    if (!enabled || !config || !isSpotifyToPlexEnabled(config)) {
        lastFailureSignature = '';
        return null;
    }
    try {
        const logs = await fetchSpotifyToPlexJson({
            config,
            path: '/api/logs',
            fetchWithTimeout,
            allowPrivate,
            timeoutMs: 12000,
        });
        const failure = detectSpotifyToPlexSyncFailure(logs);
        if (!failure) {
            lastFailureSignature = '';
            return null;
        }
        if (failure.signature === lastFailureSignature) return null;
        lastFailureSignature = failure.signature;
        const payload = { ...failure, logs };
        if (typeof onFailure === 'function') {
            try {
                const result = onFailure(payload);
                if (result && typeof result.then === 'function') result.catch(() => {});
            } catch {
                // ignore
            }
        }
        return payload;
    } catch {
        return null;
    }
};

export const startSpotifyToPlexStatusWatcher = ({
    loadConfig,
    fetchWithTimeout,
    allowPrivate = false,
    getEnabled,
    intervalMs = 60_000,
} = {}) => {
    if (timer) return;
    const tick = async () => {
        try {
            const config = typeof loadConfig === 'function' ? await loadConfig() : null;
            const enabled = typeof getEnabled === 'function'
                ? !!(await getEnabled(config))
                : isSpotifyToPlexEnabled(config);
            await pollSpotifyToPlexStatusOnce({
                config,
                enabled,
                fetchWithTimeout,
                allowPrivate,
            });
        } catch {
            // ignore
        }
    };
    timer = setInterval(tick, Math.max(30_000, Number(intervalMs) || 60_000));
    if (typeof timer.unref === 'function') timer.unref();
    void tick();
};

export const stopSpotifyToPlexStatusWatcher = () => {
    if (timer) clearInterval(timer);
    timer = null;
};
