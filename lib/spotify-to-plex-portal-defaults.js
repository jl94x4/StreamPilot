import fs from 'fs';
import path from 'path';
import { buildSpotifyToPlexPortalApplyPlan } from './spotify-to-plex-api.js';
import { getSpotifyToPlexDataDir } from './spotify-to-plex-embedded.js';

export const getSpotifyToPlexPlexConfigPath = (configDir) => (
    path.join(getSpotifyToPlexDataDir(configDir), 'plex.json')
);

/**
 * Write portal Plex URL/token into spotify-to-plex storage (plex.json) so the worker
 * does not require the embedded Plex OAuth flow.
 */
export const syncSpotifyToPlexPlexConfigFile = (config, {
    configDir,
    resolveConfiguredPlexServerUrl,
    getArrInstances,
    isArrInstanceReady,
    log = () => {},
} = {}) => {
    if (!config?.spotifyToPlexEnabled) return { written: false };
    const plan = buildSpotifyToPlexPortalApplyPlan(config, {
        resolveConfiguredPlexServerUrl,
        getArrInstances,
        isArrInstanceReady,
    });
    if (!plan.plex) {
        return { written: false, skipped: 'Plex (missing URL or token in portal Settings)' };
    }

    const dataDir = getSpotifyToPlexDataDir(configDir);
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = getSpotifyToPlexPlexConfigPath(configDir);

    let current = {};
    if (fs.existsSync(filePath)) {
        try {
            current = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch {
            current = {};
        }
    }

    const updated = {
        ...current,
        id: plan.plex.id || current.id || '',
        uri: plan.plex.uri,
        serverToken: plan.plex.serverToken,
        token: plan.plex.serverToken,
        pin_code: undefined,
        pin_id: undefined,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
    log(`[spotify-sync] Wrote portal Plex settings to ${filePath}`);
    return { written: true, path: filePath };
};

/**
 * Push portal Plex/Lidarr defaults into spotify-to-plex (file + live API when reachable).
 */
export const applySpotifyToPlexPortalDefaults = async (config, {
    configDir,
    resolveConfiguredPlexServerUrl,
    getArrInstances,
    isArrInstanceReady,
    fetchSpotifyToPlexJson,
    log = () => {},
} = {}) => {
    const plan = buildSpotifyToPlexPortalApplyPlan(config, {
        resolveConfiguredPlexServerUrl,
        getArrInstances,
        isArrInstanceReady,
    });
    const applied = [];
    const skipped = [];

    const fileSync = syncSpotifyToPlexPlexConfigFile(config, {
        configDir,
        resolveConfiguredPlexServerUrl,
        getArrInstances,
        isArrInstanceReady,
        log,
    });

    if (plan.plex) {
        let apiApplied = false;
        try {
            await fetchSpotifyToPlexJson({
                config,
                path: '/api/settings',
                method: 'POST',
                body: plan.plex,
            });
            apiApplied = true;
            applied.push('Plex connection');
        } catch (error) {
            if (fileSync.written) {
                applied.push('Plex connection (config file)');
                log(`[spotify-sync] Portal Plex file written; live API apply deferred: ${error?.message}`);
            } else {
                skipped.push(`Plex (${error?.message || 'worker unreachable'})`);
            }
        }
        if (!apiApplied && !fileSync.written) {
            skipped.push('Plex (missing URL or token in portal Settings)');
        }
    } else if (!fileSync.written) {
        skipped.push(fileSync.skipped || 'Plex (missing URL or token in portal Settings)');
    }

    if (plan.lidarr) {
        try {
            await fetchSpotifyToPlexJson({
                config,
                path: '/api/lidarr/settings',
                method: 'PUT',
                body: plan.lidarr,
            });
            applied.push('Lidarr');
        } catch (error) {
            skipped.push(`Lidarr (${error?.message || 'worker unreachable'})`);
        }
    } else {
        skipped.push('Lidarr (no enabled instance in Integrations)');
    }

    const uniqueApplied = [...new Set(applied)];
    return {
        ok: true,
        applied: uniqueApplied,
        skipped,
        message: uniqueApplied.length
            ? `Applied portal defaults: ${uniqueApplied.join(', ')}`
            : 'Nothing to apply — configure Plex and/or Lidarr in portal Settings first.',
    };
};
