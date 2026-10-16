/**
 * Portal *arr service listings for request routing (Phase 6).
 * Emits Seerr-shaped server / options DTOs from portal Arr instances.
 */

import {
    fetchArrLanguageProfiles,
    fetchArrQualityProfiles,
    fetchArrRootFolders,
    fetchArrTags,
    getArrInstance,
    getArrInstances,
    getDefaultArrInstance,
    isArrInstanceReady,
    resolveArrInstanceDefaultProfileId,
    resolveArrInstanceDefaultRootFolder,
} from '../arr-service.js';
import { inferAnimeRootFolderPath } from './animeMedia.js';

const SERVICE_OPTIONS_CACHE_MS = 60 * 1000;
const serviceOptionsCache = new Map();

/** Drop cached *arr options (e.g. after creating a tag) so validation sees fresh data. */
export const clearPortalArrServiceOptionsCache = (type = null, instanceId = null) => {
    if (!type && instanceId == null) {
        serviceOptionsCache.clear();
        return;
    }
    const arrType = type ? arrTypeForMedia(type) : null;
    for (const key of [...serviceOptionsCache.keys()]) {
        const [cachedType, cachedId] = String(key).split(':');
        if (arrType && cachedType !== arrType) continue;
        if (instanceId != null && cachedId !== String(instanceId)) continue;
        serviceOptionsCache.delete(key);
    }
};

const arrTypeForMedia = (type) => {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'music' || normalized === 'lidarr') return 'lidarr';
    if (normalized === 'movie' || normalized === 'radarr') return 'radarr';
    return 'sonarr';
};

/** Prefer explicit instance.is4k; otherwise infer from name (e.g. "Sonarr 4K"). */
export const nameLooksLike4kServer = (name = '') => /4k|uhd|2160/i.test(String(name || ''));

export const inferArrInstanceIs4k = (instance) => {
    // Name wins when present — Seerr/portal flags are often wrong or default false.
    if (nameLooksLike4kServer(instance?.name)) return true;
    if (instance?.is4k === true) return true;
    return false;
};

/** Normalize Seerr/portal server DTOs the same way. */
export const inferServerIs4k = (server = {}) => {
    if (nameLooksLike4kServer(server?.name)) return true;
    if (server?.is4k === true || server?.is4k === 1 || server?.is4k === 'true') return true;
    return false;
};

/**
 * When any server is named *4K* / *UHD*, treat only those as 4K and force the
 * rest to HD — fixes inverted Seerr "4K server" checkboxes.
 */
export const normalizeServerListIs4k = (servers = []) => {
    const list = Array.isArray(servers) ? servers : [];
    const anyNamed4k = list.some((server) => nameLooksLike4kServer(server?.name));
    return list.map((server) => {
        if (anyNamed4k) {
            return { ...server, is4k: nameLooksLike4kServer(server?.name) };
        }
        return { ...server, is4k: inferServerIs4k(server) };
    });
};

const readyInstancesForType = (config, type) => (
    getArrInstances(config, { type: arrTypeForMedia(type), enabledOnly: true })
        .filter((entry) => isArrInstanceReady(entry))
);

/** Stable 1-based numeric server id for UI selects (maps to instance list order). */
export const listPortalArrServers = (config, type) => {
    const instances = readyInstancesForType(config, type);
    return normalizeServerListIs4k(instances.map((instance, index) => ({
        id: index + 1,
        name: instance.name || ({
            radarr: 'Radarr',
            sonarr: 'Sonarr',
            lidarr: 'Lidarr',
        }[arrTypeForMedia(type)] || 'Sonarr'),
        is4k: inferArrInstanceIs4k(instance),
        isDefault: !!instance.isDefault,
        instanceId: instance.id,
    })));
};

export const resolvePortalArrInstance = (config, type, serverId = null, arrInstanceId = null) => {
    const arrType = arrTypeForMedia(type);
    const instances = readyInstancesForType(config, type);

    if (arrInstanceId) {
        const byId = getArrInstance(config, arrInstanceId);
        if (byId && byId.type === arrType && isArrInstanceReady(byId)) return byId;
    }

    const key = String(serverId ?? '').trim();
    if (key) {
        const byUuid = instances.find((entry) => entry.id === key);
        if (byUuid) return byUuid;

        const numeric = Number(key);
        if (Number.isFinite(numeric) && numeric >= 1 && numeric <= instances.length) {
            return instances[numeric - 1];
        }
    }

    return getDefaultArrInstance(config, arrType) || instances[0] || null;
};

export const getPortalArrServiceOptions = async (config, type, serverId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    arrInstanceId = null,
    timeoutMs = 8000,
} = {}) => {
    const instance = resolvePortalArrInstance(config, type, serverId, arrInstanceId);
    if (!instance) {
        const labels = { radarr: 'Radarr', sonarr: 'Sonarr', lidarr: 'Lidarr' };
        const err = new Error(`No ${labels[arrTypeForMedia(type)] || 'Sonarr'} instance is configured.`);
        err.status = 400;
        throw err;
    }

    const cacheKey = `${arrTypeForMedia(type)}:${instance.id}`;
    const cached = serviceOptionsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SERVICE_OPTIONS_CACHE_MS) {
        return cached.value;
    }

    const servers = listPortalArrServers(config, type);
    const serverMeta = servers.find((entry) => entry.instanceId === instance.id)
        || servers[0]
        || { id: 1, name: instance.name, is4k: false, isDefault: true, instanceId: instance.id };

    const fetchOpts = { resolveUrl, fetchImpl, timeoutMs };
    const [profiles, rootFolders, languageProfiles, tags] = await Promise.all([
        fetchArrQualityProfiles(instance, fetchOpts),
        fetchArrRootFolders(instance, fetchOpts),
        arrTypeForMedia(type) === 'sonarr'
            ? fetchArrLanguageProfiles(instance, fetchOpts).catch(() => [])
            : Promise.resolve([]),
        fetchArrTags(instance, fetchOpts),
    ]);

    const value = {
        server: {
            id: serverMeta.id,
            name: serverMeta.name,
            is4k: !!serverMeta.is4k,
            isDefault: !!serverMeta.isDefault,
            activeProfileId: resolveArrInstanceDefaultProfileId(instance, profiles),
            activeDirectory: resolveArrInstanceDefaultRootFolder(instance, rootFolders),
            activeLanguageProfileId: languageProfiles[0]?.id ?? null,
            activeAnimeProfileId: null,
            activeAnimeDirectory: inferAnimeRootFolderPath(rootFolders),
            activeAnimeLanguageProfileId: null,
            instanceId: instance.id,
        },
        profiles,
        rootFolders,
        languageProfiles,
        tags,
        instanceId: instance.id,
    };
    serviceOptionsCache.set(cacheKey, { at: Date.now(), value });
    return value;
};

export default {
    listPortalArrServers,
    resolvePortalArrInstance,
    getPortalArrServiceOptions,
    clearPortalArrServiceOptionsCache,
    inferArrInstanceIs4k,
};
