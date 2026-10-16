import { randomUUID } from 'crypto';
import { discardFetchBody } from './fetch-body.js';
import { resolveTvdbIdFromTmdb } from './portal-request/sonarrSeriesMatch.js';

export const ARR_TYPES = ['sonarr', 'radarr', 'lidarr', 'bazarr'];
const MAX_INSTANCES_PER_TYPE = 10;

const defaultInstanceId = (type) => `${type}-default`;

const normalizeArrType = (type = '') => {
    const normalized = String(type || '').toLowerCase();
    return ARR_TYPES.includes(normalized) ? normalized : 'sonarr';
};

const arrTypeLabel = (type = 'sonarr') => ({
    sonarr: 'Sonarr',
    radarr: 'Radarr',
    lidarr: 'Lidarr',
    bazarr: 'Bazarr',
}[normalizeArrType(type)] || 'Sonarr');

const normalizePlexLibraryIds = (value) => {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

export const normalizeArrDefaultQualityProfileId = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
};

export const normalizeArrDefaultRootFolder = (value) => String(value || '').trim();

export const resolveArrInstanceDefaultProfileId = (instance, profiles = []) => {
    const list = Array.isArray(profiles) ? profiles : [];
    const wanted = normalizeArrDefaultQualityProfileId(instance?.defaultQualityProfileId);
    if (wanted != null && list.some((entry) => Number(entry?.id) === wanted)) return wanted;
    const first = Number(list[0]?.id);
    return Number.isFinite(first) ? first : null;
};

export const resolveArrInstanceDefaultRootFolder = (instance, rootFolders = []) => {
    const list = Array.isArray(rootFolders) ? rootFolders : [];
    const wanted = normalizeArrDefaultRootFolder(instance?.defaultRootFolder);
    if (wanted && list.some((entry) => String(entry?.path || '').trim() === wanted)) return wanted;
    return String(list[0]?.path || '').trim() || null;
};

export const createArrInstance = ({
    type,
    name = '',
    url = '',
    externalUrl = '',
    apiKey = '',
    enabled = true,
    isDefault = false,
    is4k = false,
    plexLibraryIds = [],
    defaultQualityProfileId = null,
    defaultRootFolder = '',
    id = randomUUID(),
} = {}) => ({
    id: String(id),
    type: normalizeArrType(type),
    name: String(name || arrTypeLabel(type)).trim(),
    url: String(url || '').trim(),
    externalUrl: String(externalUrl || '').trim(),
    apiKey: String(apiKey || ''),
    enabled: enabled !== false,
    isDefault: !!isDefault,
    is4k: !!is4k,
    plexLibraryIds: normalizePlexLibraryIds(plexLibraryIds),
    defaultQualityProfileId: normalizeArrDefaultQualityProfileId(defaultQualityProfileId),
    defaultRootFolder: normalizeArrDefaultRootFolder(defaultRootFolder),
});

export const migrateArrConfig = (config = {}) => {
    const next = { ...config };
    if (Array.isArray(next.arrInstances) && next.arrInstances.length > 0) {
        return next;
    }

    const instances = [];
    if (next.sonarrUrl || next.sonarrApiKey) {
        instances.push(createArrInstance({
            id: defaultInstanceId('sonarr'),
            type: 'sonarr',
            name: 'Sonarr',
            url: next.sonarrUrl || '',
            apiKey: next.sonarrApiKey || '',
            enabled: true,
            isDefault: true,
        }));
    }
    if (next.radarrUrl || next.radarrApiKey) {
        instances.push(createArrInstance({
            id: defaultInstanceId('radarr'),
            type: 'radarr',
            name: 'Radarr',
            url: next.radarrUrl || '',
            apiKey: next.radarrApiKey || '',
            enabled: true,
            isDefault: true,
        }));
    }
    next.arrInstances = instances;
    return next;
};

export const syncLegacyArrFields = (config = {}) => {
    const next = migrateArrConfig(config);
    const sonarr = getDefaultArrInstance(next, 'sonarr');
    const radarr = getDefaultArrInstance(next, 'radarr');
    next.sonarrUrl = sonarr?.url || '';
    next.sonarrApiKey = sonarr?.apiKey || '';
    next.radarrUrl = radarr?.url || '';
    next.radarrApiKey = radarr?.apiKey || '';
    return next;
};

export const normalizeArrConfig = (config = {}) => syncLegacyArrFields(migrateArrConfig(config));

export const getArrInstances = (config = {}, { type = null, enabledOnly = false } = {}) => {
    const normalized = migrateArrConfig(config);
    let instances = Array.isArray(normalized.arrInstances) ? normalized.arrInstances : [];
    if (type) instances = instances.filter((entry) => entry?.type === type);
    if (enabledOnly) instances = instances.filter((entry) => entry?.enabled !== false);
    return instances;
};

export const getArrInstance = (config = {}, instanceId = '') => {
    const id = String(instanceId || '').trim();
    if (!id) return null;
    return getArrInstances(config).find((entry) => entry.id === id) || null;
};

export const getDefaultArrInstance = (config = {}, type = 'sonarr') => {
    const arrType = normalizeArrType(type);
    const instances = getArrInstances(config, { type: arrType, enabledOnly: true });
    return instances.find((entry) => entry.isDefault)
        || instances.find((entry) => entry.url && entry.apiKey)
        || instances[0]
        || null;
};

export const isArrInstanceReady = (instance) => !!(instance?.enabled !== false && instance?.url && instance?.apiKey);

export const isArrTypeConfigured = (config = {}, type = 'sonarr') => isArrInstanceReady(getDefaultArrInstance(config, type));

export const getArrCredentials = (config = {}, type = 'sonarr', instanceId = null) => {
    const arrType = normalizeArrType(type);
    const instance = instanceId
        ? getArrInstance(config, instanceId)
        : getDefaultArrInstance(config, arrType);
    if (!instance || instance.type !== arrType || !isArrInstanceReady(instance)) {
        return { url: '', apiKey: '', instance: null };
    }
    return { url: instance.url, apiKey: instance.apiKey, instance };
};

export const getArrInstanceForLibrary = (config = {}, libraryId = '', mediaType = 'movie') => {
    const arrType = mediaType === 'movie' ? 'radarr' : 'sonarr';
    const libraryKey = String(libraryId || '').trim();
    if (libraryKey) {
        const mapped = getArrInstances(config, { type: arrType, enabledOnly: true })
            .find((entry) => normalizePlexLibraryIds(entry.plexLibraryIds).includes(libraryKey));
        if (mapped) return mapped;
    }
    return getDefaultArrInstance(config, arrType);
};

const lookupEntityInMaps = (item, maps) => {
    if (!maps) return null;
    return (item?.imdbId && maps.byImdb.get(String(item.imdbId)))
        || (item?.tmdbId != null && maps.byTmdb.get(String(item.tmdbId)))
        || (item?.tvdbId != null && maps.byTvdb.get(String(item.tvdbId)))
        || null;
};

const getCandidateArrInstances = (config = {}, item = {}) => {
    const arrType = item.mediaType === 'movie' ? 'radarr' : 'sonarr';
    const libraryKey = String(item.libraryId || '').trim();
    const enabled = getArrInstances(config, { type: arrType, enabledOnly: true });
    const libraryMapped = libraryKey
        ? enabled.filter((entry) => normalizePlexLibraryIds(entry.plexLibraryIds).includes(libraryKey))
        : [];
    const defaultInstance = getDefaultArrInstance(config, arrType);
    const ordered = [];
    const seen = new Set();
    const pushUnique = (entry) => {
        if (!entry || seen.has(entry.id)) return;
        seen.add(entry.id);
        ordered.push(entry);
    };
    libraryMapped.forEach(pushUnique);
    if (defaultInstance) pushUnique(defaultInstance);
    enabled.forEach(pushUnique);
    return { arrType, instances: ordered };
};

export const resolveSonarrSeriesForShow = (showItem, catalog, config = {}) => {
    const idMatch = resolveArrEntity(showItem, catalog, config);
    if (idMatch?.entity?.id && idMatch.type === 'sonarr') {
        return { ...idMatch, matchMethod: 'external_id' };
    }

    const titleKey = String(showItem?.title || '').trim().toLowerCase();
    const year = showItem?.year != null ? Number(showItem.year) : null;
    if (!titleKey || !catalog) {
        return idMatch?.entity
            ? idMatch
            : { type: 'none', entity: null, instanceId: null, instanceName: null, matchMethod: null, ambiguous: false, warning: null, candidates: [] };
    }

    const { instances } = getCandidateArrInstances(config, showItem);
    for (const instance of instances) {
        if (instance.type !== 'sonarr') continue;
        const items = catalog.instances?.[instance.id]?.items || [];
        const candidates = items.filter((entry) => String(entry.title || '').trim().toLowerCase() === titleKey);
        if (!candidates.length) continue;

        let match = candidates[0];
        if (candidates.length > 1) {
            const byYear = year
                ? candidates.find((entry) => Number(entry.year) === year)
                : null;
            if (byYear) match = byYear;
        }

        return {
            type: 'sonarr',
            entity: match,
            instanceId: instance.id,
            instanceName: instance.name || 'Sonarr',
            ambiguous: candidates.length > 1,
            warning: candidates.length > 1
                ? 'Multiple Sonarr series share this title — verify the match.'
                : 'Matched by title in Sonarr (no shared external ID).',
            matchMethod: 'title',
            candidates: [],
        };
    }

    return idMatch?.entity
        ? idMatch
        : { type: 'none', entity: null, instanceId: null, instanceName: null, matchMethod: null, ambiguous: false, warning: null, candidates: [] };
};

export const resolveArrEntity = (item, catalog, config = {}) => {
    const empty = {
        type: 'none',
        entity: null,
        instanceId: null,
        instanceName: null,
        ambiguous: false,
        warning: null,
        candidates: [],
    };
    if (!item || !catalog) return empty;

    const { arrType, instances } = getCandidateArrInstances(config, item);
    const lookupByInstance = catalog.lookupByInstance || {};
    const instancesById = catalog.instances || {};
    const matches = [];

    for (const instance of instances) {
        const maps = lookupByInstance[instance.id];
        const entity = lookupEntityInMaps(item, maps);
        if (entity) {
            matches.push({
                instanceId: instance.id,
                instanceName: instance.name || instancesById[instance.id]?.name || (arrType === 'radarr' ? 'Radarr' : 'Sonarr'),
                entity,
            });
        }
    }

    if (matches.length === 0) {
        const enabledForType = getArrInstances(config, { type: arrType, enabledOnly: true });
        if (enabledForType.length > 1) return empty;

        const fallbackMaps = item.mediaType === 'movie' ? catalog.lookup?.radarr : catalog.lookup?.sonarr;
        const entity = lookupEntityInMaps(item, fallbackMaps);
        if (!entity) return empty;
        const fallbackInstance = getArrInstanceForLibrary(config, item.libraryId, item.mediaType);
        return {
            type: arrType,
            entity,
            instanceId: fallbackInstance?.id || null,
            instanceName: fallbackInstance?.name || (arrType === 'radarr' ? 'Radarr' : 'Sonarr'),
            ambiguous: false,
            warning: fallbackInstance ? null : 'Matched in catalog but no ready instance is configured.',
            candidates: [],
        };
    }

    const primary = matches[0];
    const ambiguous = matches.length > 1;
    const candidateNames = matches.map((entry) => entry.instanceName).filter(Boolean);
    return {
        type: arrType,
        entity: primary.entity,
        instanceId: primary.instanceId,
        instanceName: primary.instanceName,
        ambiguous,
        warning: ambiguous
            ? `Title exists in multiple ${arrType === 'radarr' ? 'Radarr' : 'Sonarr'} instances (${candidateNames.join(', ')}). Using ${primary.instanceName}.`
            : null,
        candidates: matches.map((entry) => ({
            instanceId: entry.instanceId,
            instanceName: entry.instanceName,
        })),
    };
};

const ensureSingleDefaultPerType = (instances = []) => {
    const next = instances.map((entry) => ({ ...entry }));
    for (const type of ARR_TYPES) {
        const typed = next.filter((entry) => entry.type === type);
        if (typed.length === 0) continue;
        let defaultIndex = typed.findIndex((entry) => entry.isDefault);
        if (defaultIndex < 0) defaultIndex = 0;
        const defaultId = typed[defaultIndex].id;
        next.forEach((entry) => {
            if (entry.type === type) entry.isDefault = entry.id === defaultId;
        });
    }
    return next;
};

export const sanitizeArrInstances = (
    incomingInstances,
    existingConfig = {},
    { resolveSecret, resolveConfigIntegrationUrl, secretMask = '••••••••' } = {}
) => {
    if (!Array.isArray(incomingInstances)) {
        return getArrInstances(existingConfig);
    }

    const existingInstances = getArrInstances(existingConfig);
    const existingById = new Map(existingInstances.map((entry) => [entry.id, entry]));
    const sanitized = [];

    for (const raw of incomingInstances.slice(0, MAX_INSTANCES_PER_TYPE * ARR_TYPES.length)) {
        const type = ARR_TYPES.includes(String(raw?.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : null;
        if (!type) continue;

        const id = String(raw?.id || randomUUID());
        const existing = existingById.get(id) || null;
        const name = String(raw?.name || existing?.name || arrTypeLabel(type)).trim() || arrTypeLabel(type);
        const safeUrl = resolveConfigIntegrationUrl
            ? resolveConfigIntegrationUrl(raw?.url, existing?.url || '')
            : String(raw?.url || existing?.url || '').trim();
        const safeExternalUrl = resolveConfigIntegrationUrl
            ? resolveConfigIntegrationUrl(raw?.externalUrl, existing?.externalUrl || '')
            : String(raw?.externalUrl || existing?.externalUrl || '').trim();
        const apiKey = resolveSecret
            ? resolveSecret(raw?.apiKey, existing?.apiKey || '')
            : String(raw?.apiKey || existing?.apiKey || '');

        sanitized.push(createArrInstance({
            id,
            type,
            name,
            url: safeUrl,
            externalUrl: safeExternalUrl,
            apiKey: apiKey === secretMask ? (existing?.apiKey || '') : apiKey,
            enabled: raw?.enabled !== false,
            isDefault: !!raw?.isDefault,
            is4k: raw?.is4k != null ? !!raw.is4k : !!existing?.is4k,
            plexLibraryIds: raw?.plexLibraryIds ?? existing?.plexLibraryIds ?? [],
            defaultQualityProfileId: raw?.defaultQualityProfileId !== undefined
                ? raw.defaultQualityProfileId
                : existing?.defaultQualityProfileId,
            defaultRootFolder: raw?.defaultRootFolder !== undefined
                ? raw.defaultRootFolder
                : existing?.defaultRootFolder,
        }));
    }

    const typedCounts = ARR_TYPES.reduce((acc, type) => {
        acc[type] = sanitized.filter((entry) => entry.type === type).length;
        return acc;
    }, {});
    for (const type of ARR_TYPES) {
        if (typedCounts[type] > MAX_INSTANCES_PER_TYPE) {
            throw new Error(`Too many ${type} instances (max ${MAX_INSTANCES_PER_TYPE}).`);
        }
    }

    return ensureSingleDefaultPerType(sanitized);
};

export const maskArrInstancesForApi = (instances = [], secretMask = '••••••••') => (
    (Array.isArray(instances) ? instances : []).map((entry) => ({
        id: entry.id,
        type: entry.type,
        name: entry.name || '',
        url: entry.url || '',
        externalUrl: entry.externalUrl || '',
        apiKey: entry.apiKey ? secretMask : '',
        enabled: entry.enabled !== false,
        isDefault: !!entry.isDefault,
        is4k: !!entry.is4k,
        plexLibraryIds: normalizePlexLibraryIds(entry.plexLibraryIds),
        defaultQualityProfileId: normalizeArrDefaultQualityProfileId(entry.defaultQualityProfileId),
        defaultRootFolder: normalizeArrDefaultRootFolder(entry.defaultRootFolder),
    }))
);

export const mergeLegacyArrFieldsIntoInstances = (body = {}, existingConfig = {}, helpers = {}) => {
    const hasLegacySonarr = 'sonarrUrl' in body || 'sonarrApiKey' in body;
    const hasLegacyRadarr = 'radarrUrl' in body || 'radarrApiKey' in body;
    const hasInstances = Array.isArray(body.arrInstances);

    if (hasInstances) {
        return sanitizeArrInstances(body.arrInstances, existingConfig, helpers);
    }

    const instances = getArrInstances(existingConfig);
    const next = instances.map((entry) => ({ ...entry }));

    const upsertLegacy = (type, url, apiKey) => {
        const arrType = normalizeArrType(type);
        const existing = next.find((entry) => entry.type === arrType && entry.isDefault)
            || next.find((entry) => entry.type === arrType);
        const safeUrl = helpers.resolveConfigIntegrationUrl
            ? helpers.resolveConfigIntegrationUrl(url, existing?.url || '')
            : String(url || existing?.url || '').trim();
        const resolvedKey = helpers.resolveSecret
            ? helpers.resolveSecret(apiKey, existing?.apiKey || '')
            : String(apiKey || existing?.apiKey || '');

        if (existing) {
            existing.url = safeUrl;
            existing.apiKey = resolvedKey;
            existing.enabled = existing.enabled !== false;
            return;
        }
        if (!safeUrl && !resolvedKey) return;
        next.push(createArrInstance({
            id: defaultInstanceId(arrType),
            type: arrType,
            name: arrTypeLabel(arrType),
            url: safeUrl,
            apiKey: resolvedKey,
            enabled: true,
            isDefault: true,
        }));
    };

    if (hasLegacySonarr) upsertLegacy('sonarr', body.sonarrUrl, body.sonarrApiKey);
    if (hasLegacyRadarr) upsertLegacy('radarr', body.radarrUrl, body.radarrApiKey);

    return ensureSingleDefaultPerType(next);
};

export const fetchArrInstance = async (instance, endpoint, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    headers = {},
    method = 'GET',
    body = null,
    timeoutMs = 0,
} = {}) => {
    if (!isArrInstanceReady(instance)) return null;
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
    const controller = ms > 0 && typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;
    try {
        const safeBaseUrl = resolveUrl(instance.url);
        const base = safeBaseUrl.endsWith('/') ? safeBaseUrl.slice(0, -1) : safeBaseUrl;
        const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        const response = await fetchImpl(`${base}${path}`, {
            method,
            headers: {
                'X-Api-Key': instance.apiKey,
                Accept: 'application/json',
                ...(body != null ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            ...(body != null ? { body: JSON.stringify(body) } : {}),
            // Let fetchWithTimeout honour our longer write timeouts instead of its 15s default.
            ...(ms > 0 ? { timeoutMs: ms } : {}),
            ...(controller ? { signal: controller.signal } : {}),
        });
        const contentType = response.headers.get('content-type') || '';
        let data = null;
        try {
            if (contentType.includes('application/json')) data = await response.json();
            else if (!response.ok) data = await response.text();
            else discardFetchBody(response);
        } catch {
            discardFetchBody(response);
            data = null;
        }
        if (!response.ok) return { ok: false, status: response.status, data };
        return { ok: true, status: response.status, data };
    } catch {
        return { ok: false, status: 0, data: null };
    } finally {
        if (timer) clearTimeout(timer);
    }
};

/** @deprecated use fetchArrInstance return shape — kept for existing GET callers */
export const fetchArrInstanceJson = async (instance, endpoint, options = {}) => {
    const result = await fetchArrInstance(instance, endpoint, options);
    return result?.ok ? result.data : null;
};

export const buildArrLookupMapsForItems = (items = []) => {
    const maps = { byImdb: new Map(), byTmdb: new Map(), byTvdb: new Map() };
    const addEntry = (entry) => {
        const imdb = entry?.imdbId ? String(entry.imdbId) : null;
        const tmdb = entry?.tmdbId != null ? String(entry.tmdbId) : null;
        const tvdb = entry?.tvdbId != null ? String(entry.tvdbId) : null;
        if (imdb) maps.byImdb.set(imdb, entry);
        if (tmdb) maps.byTmdb.set(tmdb, entry);
        if (tvdb) maps.byTvdb.set(tvdb, entry);
    };
    (Array.isArray(items) ? items : []).forEach(addEntry);
    return maps;
};

export const getArrInstanceCounts = (config = {}) => {
    const countReady = (instances) => instances.filter(isArrInstanceReady).length;
    return ARR_TYPES.reduce((acc, type) => {
        const instances = getArrInstances(config, { type });
        acc[type] = {
            total: instances.length,
            enabled: instances.filter((entry) => entry.enabled !== false).length,
            ready: countReady(instances),
        };
        return acc;
    }, {});
};

export const fetchArrInstanceCatalogItems = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 90_000 } = {}) => {
    if (!isArrInstanceReady(instance)) return [];
    const endpoint = instance.type === 'radarr'
        ? '/api/v3/movie'
        : (instance.type === 'lidarr' ? '/api/v1/artist' : '/api/v3/series');
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 90_000;
    const payload = await fetchArrInstanceJson(instance, endpoint, { resolveUrl, fetchImpl, timeoutMs: ms });
    return Array.isArray(payload) ? payload : [];
};

/** Public metadata CDNs that must never be treated as private *arr hosts. */
const PUBLIC_ARR_IMAGE_HOSTS = /(?:^|\.)(?:lidarr\.audio|servarr\.com|fanart\.tv|theaudiodb\.com|tmdb\.org|coverartarchive\.org|archive\.org|mzstatic\.com)$/i;

const isLikelyPrivateArrImageUrl = (url = '') => {
    const raw = String(url || '').trim().toLowerCase();
    if (!raw) return true;
    if (raw.startsWith('/mediacover/') || raw.startsWith('mediacover/')) return true;
    try {
        const host = new URL(raw, 'http://relative.invalid').hostname;
        if (PUBLIC_ARR_IMAGE_HOSTS.test(host)) return false;
    } catch {
        // Fall through to the pattern checks below.
    }
    return /(?:^|\/\/)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw)
        || /(?:^|\/\/)[^/]*(?:lidarr|radarr|sonarr)[^/]*(?::\d+)?(?:\/|$)/i.test(raw);
};

/**
 * Browser-safe Lidarr artist image.
 * Prefer remoteUrl — Lidarr's `url` is usually /MediaCover/... on the Lidarr host.
 * When only a local cover exists, return a portal proxy path if instance + artist id are known.
 */
export const pickLidarrArtistImage = (artist = {}, { instance = null } = {}) => {
    const images = Array.isArray(artist?.images) ? artist.images : [];
    const poster = images.find((img) => String(img?.coverType || '').toLowerCase() === 'poster')
        || images.find((img) => String(img?.coverType || '').toLowerCase() === 'cover')
        || images.find((img) => img?.remoteUrl || img?.url)
        || images[0]
        || null;
    const remoteUrl = String(poster?.remoteUrl || '').trim();
    if (remoteUrl && !isLikelyPrivateArrImageUrl(remoteUrl)) return remoteUrl;

    const artistId = Number(artist?.id);
    const instanceId = String(instance?.id || '').trim();
    if (instanceId && Number.isFinite(artistId) && artistId > 0) {
        return `/api/discovery/music/cover?instanceId=${encodeURIComponent(instanceId)}&artistId=${artistId}`;
    }

    const url = String(poster?.url || '').trim();
    if (url && !isLikelyPrivateArrImageUrl(url)) return url;
    return null;
};

const arrApiPrefix = (instance) => (instance?.type === 'lidarr' ? '/api/v1' : '/api/v3');

export const fetchArrQualityProfiles = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
    const payload = await fetchArrInstanceJson(instance, `${arrApiPrefix(instance)}/qualityprofile`, { resolveUrl, fetchImpl, timeoutMs });
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => ({
        id: Number(entry.id),
        name: String(entry.name || `Profile ${entry.id}`),
    })).filter((entry) => Number.isFinite(entry.id));
};

export const updateArrEntityQualityProfile = async (instance, entity, type, qualityProfileId, { resolveUrl = (url) => url, fetchImpl = fetch } = {}) => {
    if (!entity?.id || !qualityProfileId) return { ok: false, reason: 'Missing entity or quality profile' };
    const arrType = type === 'radarr' ? 'radarr' : 'sonarr';
    const endpoint = arrType === 'radarr' ? `/api/v3/movie/${entity.id}` : `/api/v3/series/${entity.id}`;
    const result = await fetchArrInstance(instance, endpoint, {
        resolveUrl,
        fetchImpl,
        method: 'PUT',
        body: { ...entity, qualityProfileId: Number(qualityProfileId) },
    });
    if (!result?.ok) return { ok: false, reason: `Quality profile update failed (${result?.status || 'unknown'})` };
    return { ok: true, entity: result.data || { ...entity, qualityProfileId: Number(qualityProfileId) } };
};

export const triggerArrEntitySearch = async (instance, entity, type, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 30000 } = {}) => {
    if (!entity?.id) return { ok: false, reason: 'Missing ARR entity id' };
    const arrType = type === 'radarr' ? 'radarr' : 'sonarr';
    // Seerr uses MissingEpisodeSearch for TV; SeriesSearch can be heavier and is not needed for approve.
    const command = arrType === 'radarr'
        ? { name: 'MoviesSearch', movieIds: [entity.id] }
        : { name: 'MissingEpisodeSearch', seriesId: entity.id };
    const result = await fetchArrInstance(instance, '/api/v3/command', {
        resolveUrl,
        fetchImpl,
        method: 'POST',
        body: command,
        timeoutMs,
    });
    if (!result?.ok) return { ok: false, reason: `Search command failed (${result?.status || 'unknown'})` };
    return { ok: true, commandId: result.data?.id || null };
};

/** Kick off a download search without blocking approve / add. */
const queueArrEntitySearch = (instance, entity, type, fetchOpts = {}) => {
    void triggerArrEntitySearch(instance, entity, type, {
        ...fetchOpts,
        timeoutMs: 10000,
    }).catch(() => {});
};

export const fetchSonarrEpisodesForSeries = async (instance, seriesId, { resolveUrl = (url) => url, fetchImpl = fetch } = {}) => {
    const id = Number(seriesId || 0);
    if (!id) return [];
    const payload = await fetchArrInstanceJson(instance, `/api/v3/episode?seriesId=${id}`, { resolveUrl, fetchImpl });
    return Array.isArray(payload) ? payload : [];
};

export const fetchSonarrEpisodeFilesForSeries = async (instance, seriesId, { resolveUrl = (url) => url, fetchImpl = fetch } = {}) => {
    const id = Number(seriesId || 0);
    if (!id) return [];
    const payload = await fetchArrInstanceJson(instance, `/api/v3/episodefile?seriesId=${id}`, { resolveUrl, fetchImpl });
    return Array.isArray(payload) ? payload : [];
};

const sonarrSeriesIdsLikelyWithFiles = (seriesList = []) => {
    const withStats = (Array.isArray(seriesList) ? seriesList : [])
        .filter((series) => {
            const stats = series?.statistics || {};
            return Number(stats.episodeFileCount || 0) > 0 || Number(stats.sizeOnDisk || 0) > 0;
        })
        .map((series) => Number(series.id))
        .filter((id) => id > 0);
    if (withStats.length) return withStats;
    return (Array.isArray(seriesList) ? seriesList : [])
        .map((series) => Number(series.id))
        .filter((id) => id > 0);
};

const runConcurrentTasks = async (items = [], concurrency = 16, worker = async () => null) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const limit = Math.max(1, Math.min(Number(concurrency) || 16, list.length));
    const results = new Array(list.length);
    let cursor = 0;
    const runners = Array.from({ length: limit }, async () => {
        while (cursor < list.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(list[index], index);
        }
    });
    await Promise.all(runners);
    return results;
};

export const fetchSonarrAllEpisodeFiles = async (instance, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    seriesList = [],
    concurrency = 24,
} = {}) => {
    const bulkResult = await fetchArrInstance(instance, '/api/v3/episodefile', { resolveUrl, fetchImpl });
    if (bulkResult?.ok && Array.isArray(bulkResult.data) && bulkResult.data.length > 0) {
        return bulkResult.data;
    }

    const seriesIds = sonarrSeriesIdsLikelyWithFiles(seriesList);
    if (!seriesIds.length) return [];

    const perSeriesResults = await runConcurrentTasks(seriesIds, concurrency, async (seriesId) => (
        fetchSonarrEpisodeFilesForSeries(instance, seriesId, { resolveUrl, fetchImpl })
    ));
    return perSeriesResults.flat();
};

export const fetchSonarrAllEpisodes = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch } = {}) => {
    const payload = await fetchArrInstanceJson(instance, '/api/v3/episode', { resolveUrl, fetchImpl });
    return Array.isArray(payload) ? payload : [];
};

export const fetchSonarrSeriesById = async (instance, seriesId, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 30000 } = {}) => {
    const id = Number(seriesId || 0);
    if (!id) return null;
    return fetchArrInstanceJson(instance, `/api/v3/series/${id}`, { resolveUrl, fetchImpl, timeoutMs });
};

export const triggerSonarrEpisodeSearch = async (instance, episodeIds = [], { resolveUrl = (url) => url, fetchImpl = fetch } = {}) => {
    const ids = (Array.isArray(episodeIds) ? episodeIds : []).map(Number).filter((id) => id > 0);
    if (!ids.length) return { ok: false, reason: 'No episode ids provided' };
    const result = await fetchArrInstance(instance, '/api/v3/command', {
        resolveUrl,
        fetchImpl,
        method: 'POST',
        body: { name: 'EpisodeSearch', episodeIds: ids },
    });
    if (!result?.ok) return { ok: false, reason: `Episode search failed (${result?.status || 'unknown'})` };
    return { ok: true, commandId: result.data?.id || null };
};

export const fetchArrQueueSummary = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 0 } = {}) => {
    const prefix = instance?.type === 'lidarr' ? '/api/v1' : '/api/v3';
    const payload = await fetchArrInstanceJson(instance, `${prefix}/queue`, { resolveUrl, fetchImpl, timeoutMs });
    if (!payload) return { total: 0, records: [] };
    const records = Array.isArray(payload?.records) ? payload.records : (Array.isArray(payload) ? payload : []);
    const total = Number(payload?.totalRecords ?? records.length ?? 0);
    return { total, records };
};

const slugifyArrTitle = (title = '') => String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const buildArrDeepUrl = (instance, entity, type = null) => {
    if (!instance?.url || !entity) return null;
    const base = String(instance.externalUrl || instance.url || '').replace(/\/+$/, '');
    const arrType = type || instance.type;
    if (arrType === 'radarr') {
        const tmdbId = entity.tmdbId ?? entity.foreignId;
        if (tmdbId == null) return null;
        return `${base}/movie/${tmdbId}`;
    }
    if (arrType === 'sonarr') {
        const slug = entity.titleSlug || slugifyArrTitle(entity.title);
        if (!slug) return null;
        return `${base}/series/${slug}`;
    }
    if (arrType === 'lidarr') {
        const slug = entity.titleSlug || slugifyArrTitle(entity.artistName || entity.title);
        if (!slug) return null;
        return `${base}/artist/${slug}`;
    }
    return null;
};

const normalizeRadarrReleaseDate = (value) => {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('0001-')) return null;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const pickRadarrReleaseDates = (movie = {}) => {
    const inCinemas = normalizeRadarrReleaseDate(movie.inCinemas);
    const digitalRelease = normalizeRadarrReleaseDate(movie.digitalRelease);
    const physicalRelease = normalizeRadarrReleaseDate(movie.physicalRelease);
    if (!inCinemas && !digitalRelease && !physicalRelease) return null;
    return { inCinemas, digitalRelease, physicalRelease };
};

/** Radarr metadata release dates for a TMDB movie id (via Radarr lookup). */
export const fetchRadarrMovieReleaseDates = async (config, tmdbId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
} = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const instance = getDefaultArrInstance(config, 'radarr');
    if (!isArrInstanceReady(instance)) return null;

    const fetchOpts = { resolveUrl, fetchImpl };
    const lookupPayload = await fetchArrInstanceJson(instance, `/api/v3/movie/lookup/tmdb?tmdbId=${id}`, fetchOpts);
    const lookupMovie = Array.isArray(lookupPayload) ? lookupPayload[0] : lookupPayload;
    const dates = pickRadarrReleaseDates(lookupMovie);
    if (!dates) return null;

    return {
        ...dates,
        instanceName: instance.name || 'Radarr',
    };
};

const arrErrorMessage = (result, fallback) => {
    const data = result?.data;
    if (typeof data === 'string' && data.trim()) return data.trim();
    if (Array.isArray(data) && data[0]?.errorMessage) return String(data[0].errorMessage);
    if (data?.message) return String(data.message);
    if (data?.errorMessage) return String(data.errorMessage);
    // Radarr/Sonarr validation payloads: { propertyName, errorMessage }[]
    if (Array.isArray(data) && data[0]?.propertyName && data[0]?.errorMessage) {
        return data.map((row) => String(row.errorMessage || '')).filter(Boolean).join('; ') || fallback;
    }
    if (result?.status) return `${fallback} (HTTP ${result.status})`;
    return fallback;
};

const arrErrorLooksLike = (result, pattern) => pattern.test(arrErrorMessage(result, ''));

/** Prefer library hit (has numeric id) when lookup omits it. */
const findRadarrMovieInLibrary = async (instance, tmdbId, fetchOpts = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const list = await fetchArrInstanceJson(instance, '/api/v3/movie', fetchOpts);
    if (!Array.isArray(list)) return null;
    return list.find((movie) => Number(movie?.tmdbId) === id) || null;
};

/** Absolute poster URL from a Radarr/Sonarr entity `images` list. */
export const pickArrPosterUrl = (entity) => {
    const images = Array.isArray(entity?.images) ? entity.images : [];
    const poster = images.find((img) => String(img?.coverType || '').toLowerCase() === 'poster')
        || images.find((img) => img?.remoteUrl || img?.url)
        || null;
    const url = String(poster?.remoteUrl || poster?.url || '').trim();
    return url || null;
};

export const fetchArrRootFolders = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
    const payload = await fetchArrInstanceJson(instance, `${arrApiPrefix(instance)}/rootfolder`, { resolveUrl, fetchImpl, timeoutMs });
    if (!Array.isArray(payload)) return [];
    return payload.map((entry, index) => {
        const id = Number(entry?.id);
        return {
            id: Number.isFinite(id) ? id : index + 1,
            path: String(entry?.path || '').trim(),
            freeSpace: entry?.freeSpace ?? null,
        };
    }).filter((entry) => entry.path);
};

export const fetchArrTags = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
    const payload = await fetchArrInstanceJson(instance, `${arrApiPrefix(instance)}/tag`, { resolveUrl, fetchImpl, timeoutMs });
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => ({
        id: Number(entry.id),
        label: String(entry.label || entry.name || entry.id),
    })).filter((entry) => Number.isFinite(entry.id));
};

export const fetchArrLanguageProfiles = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
    const payload = await fetchArrInstanceJson(instance, '/api/v3/languageprofile', { resolveUrl, fetchImpl, timeoutMs });
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => ({
        id: Number(entry.id),
        name: String(entry.name || `Language ${entry.id}`),
    })).filter((entry) => Number.isFinite(entry.id));
};

export const lookupRadarrMovieByTmdb = async (instance, tmdbId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 30000,
} = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0 || !isArrInstanceReady(instance)) return null;
    const payload = await fetchArrInstanceJson(instance, `/api/v3/movie/lookup/tmdb?tmdbId=${id}`, {
        resolveUrl,
        fetchImpl,
        timeoutMs,
    });
    return Array.isArray(payload) ? (payload[0] || null) : (payload || null);
};

export const lookupSonarrSeriesByTmdb = async (instance, tmdbId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 30000,
} = {}) => {
    const id = Number(tmdbId);
    if (!Number.isFinite(id) || id <= 0 || !isArrInstanceReady(instance)) return null;
    const payload = await fetchArrInstanceJson(instance, `/api/v3/series/lookup?term=tmdb:${id}`, {
        resolveUrl,
        fetchImpl,
        timeoutMs,
    });
    const list = Array.isArray(payload) ? payload : [];
    return list.find((entry) => Number(entry?.tmdbId) === id) || list[0] || null;
};

/** Sonarr is TVDB-first — look up by tvdb: when TMDB ids are missing on library rows. */
export const lookupSonarrSeriesByTvdb = async (instance, tvdbId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 12000,
} = {}) => {
    const id = Number(tvdbId);
    if (!Number.isFinite(id) || id <= 0 || !isArrInstanceReady(instance)) return null;
    const payload = await fetchArrInstanceJson(instance, `/api/v3/series/lookup?term=tvdb:${id}`, {
        resolveUrl,
        fetchImpl,
        timeoutMs,
    });
    const list = Array.isArray(payload) ? payload : [];
    // Prefer an already-monitored library hit (has numeric id).
    return list.find((entry) => entry?.id && Number(entry?.tvdbId) === id)
        || list.find((entry) => Number(entry?.tvdbId) === id)
        || list.find((entry) => entry?.id)
        || list[0]
        || null;
};

/**
 * Add a movie to Radarr (or return existing) and optionally search.
 * @returns {{ ok: boolean, created: boolean, entity?: object, reason?: string }}
 */
export const addRadarrMovie = async (instance, {
    tmdbId,
    qualityProfileId,
    rootFolderPath,
    tags = [],
    monitored = true,
    search = true,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
} = {}) => {
    if (!isArrInstanceReady(instance)) return { ok: false, created: false, reason: 'Radarr instance is not ready' };
    const profileId = Number(qualityProfileId);
    const folder = String(rootFolderPath || '').trim();
    if (!Number.isFinite(profileId) || !folder) {
        return { ok: false, created: false, reason: 'Quality profile and root folder are required' };
    }

    const fetchOpts = { resolveUrl, fetchImpl, timeoutMs: 20000 };
    const wantedTmdb = Number(tmdbId);

    const claimExistingMovie = (entity) => {
        if (search && entity?.id) queueArrEntitySearch(instance, entity, 'radarr', fetchOpts);
        return { ok: true, created: false, entity };
    };

    // Lookup first — dumping /api/v3/movie on every approve stalled large libraries.
    const lookup = await lookupRadarrMovieByTmdb(instance, tmdbId, fetchOpts);
    if (!lookup) return { ok: false, created: false, reason: 'Radarr could not look up this movie on TMDB' };

    if (lookup.id) return claimExistingMovie(lookup);

    const body = {
        title: lookup.title,
        tmdbId: Number(lookup.tmdbId) || wantedTmdb,
        qualityProfileId: profileId,
        rootFolderPath: folder,
        monitored: monitored !== false,
        minimumAvailability: lookup.minimumAvailability || 'released',
        tags: Array.isArray(tags) ? tags.map((t) => Number(t)).filter((n) => Number.isFinite(n)) : [],
        // Search after add so Radarr's POST returns instead of waiting on indexers.
        addOptions: { searchForMovie: false },
    };
    if (lookup.imdbId) body.imdbId = lookup.imdbId;
    if (lookup.year) body.year = lookup.year;
    if (lookup.titleSlug) body.titleSlug = lookup.titleSlug;

    const result = await fetchArrInstance(instance, '/api/v3/movie', {
        ...fetchOpts,
        method: 'POST',
        body,
    });
    if (!result?.ok) {
        // Race / stale lookup: movie was added between lookup and POST.
        if (arrErrorLooksLike(result, /already been added/i)) {
            const raced = await findRadarrMovieInLibrary(instance, wantedTmdb, fetchOpts);
            if (raced?.id) return claimExistingMovie(raced);
        }
        if (arrErrorLooksLike(result, /malformed|corrupt|disk image/i)) {
            return {
                ok: false,
                created: false,
                reason: 'Radarr database is corrupted (SQLite malformed). Repair or restore radarr.db, then retry.',
            };
        }
        return { ok: false, created: false, reason: arrErrorMessage(result, 'Failed to add movie to Radarr') };
    }
    if (search && result.data?.id) queueArrEntitySearch(instance, result.data, 'radarr', fetchOpts);
    return { ok: true, created: true, entity: result.data };
};

/**
 * Build season monitored flags for Sonarr add/update (Seerr-style).
 * @param {number[]|'all'|null} selected
 * @param {object[]} existingSeasons
 */
const buildSonarrSeasonMonitorList = (selected, existingSeasons = []) => {
    const list = Array.isArray(existingSeasons) ? existingSeasons : [];
    const selectedSet = selected === 'all' || selected == null
        ? null
        : new Set(
            (Array.isArray(selected) ? selected : [])
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n >= 0),
        );

    return list.map((season) => {
        const seasonNumber = Number(season?.seasonNumber);
        const isSpecial = seasonNumber === 0;
        let monitored = false;
        if (selectedSet == null) {
            monitored = !isSpecial;
        } else {
            monitored = selectedSet.has(seasonNumber);
        }
        return {
            seasonNumber,
            monitored,
        };
    });
};

/**
 * Resolve a Sonarr series payload for add/update.
 * Sonarr is TVDB-first — `term=tmdb:` often returns nothing for new shows even when
 * TheTVDB (and TMDB external_ids) already have the series. Prefer TVDB when known.
 */
export const lookupSonarrSeriesForAdd = async (instance, {
    tmdbId = null,
    tvdbId = null,
    config = null,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 12000,
} = {}) => {
    const fetchOpts = { resolveUrl, fetchImpl, timeoutMs };
    const wantedTvdb = Number(tvdbId);
    const wantedTmdb = Number(tmdbId);
    let triedTvdb = false;

    if (Number.isFinite(wantedTvdb) && wantedTvdb > 0) {
        triedTvdb = true;
        const byTvdb = await lookupSonarrSeriesByTvdb(instance, wantedTvdb, fetchOpts);
        if (byTvdb) return byTvdb;
    }

    if (Number.isFinite(wantedTmdb) && wantedTmdb > 0) {
        const byTmdb = await lookupSonarrSeriesByTmdb(instance, wantedTmdb, fetchOpts);
        if (byTmdb) return byTmdb;

        // Bridge via TMDB external_ids → TVDB when Sonarr's tmdb: term misses.
        // Skip when we already attempted a known TVDB id above.
        if (config && !triedTvdb) {
            const resolvedTvdb = await resolveTvdbIdFromTmdb(config, wantedTmdb, { fetchImpl, timeoutMs: 5000 });
            if (resolvedTvdb) {
                const byResolvedTvdb = await lookupSonarrSeriesByTvdb(instance, resolvedTvdb, fetchOpts);
                if (byResolvedTvdb) return byResolvedTvdb;
            }
        }
    }

    return null;
};

/**
 * Add a series to Sonarr (or acknowledge existing) and optionally search missing.
 * Uses a Seerr-style payload — never POST the raw lookup blob (breaks Sonarr v4 / truncates on abort).
 * @returns {{ ok: boolean, created: boolean, entity?: object, reason?: string }}
 */
export const addSonarrSeries = async (instance, {
    tmdbId,
    tvdbId: tvdbIdHint = null,
    qualityProfileId,
    rootFolderPath,
    languageProfileId = null,
    tags = [],
    seasons = 'all',
    monitored = true,
    search = true,
    config = null,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
} = {}) => {
    if (!isArrInstanceReady(instance)) return { ok: false, created: false, reason: 'Sonarr instance is not ready' };
    const profileId = Number(qualityProfileId);
    const folder = String(rootFolderPath || '').trim();
    if (!Number.isFinite(profileId) || !folder) {
        return { ok: false, created: false, reason: 'Quality profile and root folder are required' };
    }

    // Keep lookups snappy — stacked Sonarr I/O was causing blank nginx 502s on approve.
    const fetchOpts = { resolveUrl, fetchImpl, timeoutMs: 12000 };
    const wantedTmdb = Number(tmdbId);
    let wantedTvdb = Number(tvdbIdHint);
    if ((!Number.isFinite(wantedTvdb) || wantedTvdb <= 0) && config && Number.isFinite(wantedTmdb) && wantedTmdb > 0) {
        wantedTvdb = Number(await resolveTvdbIdFromTmdb(config, wantedTmdb, { fetchImpl, timeoutMs: 5000 })) || null;
    }

    const tagIds = Array.isArray(tags) ? tags.map((t) => Number(t)).filter((n) => Number.isFinite(n)) : [];

    /**
     * Series already in Sonarr: claim success immediately.
     * Heavy PUT/search runs best-effort in the background so Retry never waits on Sonarr I/O.
     */
    const claimExistingSeries = (entity) => {
        if (!entity?.id) return { ok: false, created: false, reason: 'Sonarr series id missing' };

        void (async () => {
            try {
                const existing = await fetchSonarrSeriesById(instance, entity.id, {
                    ...fetchOpts,
                    timeoutMs: 10000,
                }) || entity;
                const mergedTags = Array.from(new Set([
                    ...(Array.isArray(existing.tags) ? existing.tags.map(Number).filter((n) => Number.isFinite(n)) : []),
                    ...tagIds,
                ]));
                const updatedSeasons = buildSonarrSeasonMonitorList(
                    seasons,
                    Array.isArray(existing.seasons) && existing.seasons.length ? existing.seasons : [],
                ).map((season) => {
                    const prior = (existing.seasons || []).find((s) => Number(s?.seasonNumber) === season.seasonNumber);
                    return {
                        ...prior,
                        seasonNumber: season.seasonNumber,
                        monitored: !!(prior?.monitored || season.monitored),
                    };
                });
                const putBody = {
                    ...existing,
                    monitored: monitored !== false,
                    qualityProfileId: profileId,
                    seasons: updatedSeasons,
                    tags: mergedTags,
                };
                delete putBody.languageProfileId;
                delete putBody.addOptions;
                await fetchArrInstance(instance, `/api/v3/series/${existing.id}`, {
                    ...fetchOpts,
                    method: 'PUT',
                    body: putBody,
                    timeoutMs: 10000,
                });
                if (search) {
                    queueArrEntitySearch(instance, existing, 'sonarr', {
                        ...fetchOpts,
                        timeoutMs: 10000,
                    });
                }
            } catch {
                // Background sync is best-effort.
            }
        })();

        return {
            ok: true,
            created: false,
            entity,
            reason: 'Already in Sonarr',
        };
    };

    const lookup = await lookupSonarrSeriesForAdd(instance, {
        tmdbId: wantedTmdb,
        tvdbId: wantedTvdb,
        config,
        ...fetchOpts,
    });
    const resolved = lookup;
    if (!resolved) {
        return {
            ok: false,
            created: false,
            reason: 'Sonarr could not look up this series on TVDB/TMDB. Confirm it exists in TheTVDB and that Sonarr can reach its metadata provider.',
        };
    }

    if (resolved.id) {
        return claimExistingSeries(resolved);
    }

    // Lookup without id — try title term once to find the library row.
    if (resolved.title) {
        const titleTerm = String(resolved.title).trim();
        if (titleTerm) {
            const titleHits = await fetchArrInstanceJson(
                instance,
                `/api/v3/series/lookup?term=${encodeURIComponent(titleTerm)}`,
                { ...fetchOpts, timeoutMs: 8000 },
            );
            const list = Array.isArray(titleHits) ? titleHits : [];
            const inLibrary = list.find((row) => row?.id && (
                (Number.isFinite(wantedTmdb) && Number(row.tmdbId) === wantedTmdb)
                || (Number.isFinite(wantedTvdb) && Number(row.tvdbId) === wantedTvdb)
                || String(row.title || '').toLowerCase() === titleTerm.toLowerCase()
            ));
            if (inLibrary?.id) return claimExistingSeries(inLibrary);
        }
    }

    const tvdbId = Number(resolved.tvdbId) || Number(wantedTvdb);
    if (!Number.isFinite(tvdbId) || tvdbId <= 0) {
        return { ok: false, created: false, reason: 'Sonarr lookup is missing a TVDB id for this series' };
    }

    const seasonList = buildSonarrSeasonMonitorList(seasons, resolved.seasons);

    const body = {
        title: resolved.title,
        tvdbId,
        qualityProfileId: profileId,
        rootFolderPath: folder,
        monitored: monitored !== false,
        // Sonarr lookup templates often ship seasonFolder:false; always enable for portal adds.
        seasonFolder: true,
        seriesType: resolved.seriesType || 'standard',
        tags: tagIds,
        seasons: seasonList,
        addOptions: {
            ignoreEpisodesWithFiles: true,
            searchForMissingEpisodes: false,
            searchForCutoffUnmetEpisodes: false,
        },
    };
    if (resolved.imdbId) body.imdbId = resolved.imdbId;
    if (resolved.titleSlug) body.titleSlug = resolved.titleSlug;
    if (resolved.tmdbId) body.tmdbId = Number(resolved.tmdbId);

    // Sonarr v4 deprecated language profiles — set when provided, skip the options round-trip.
    const langId = Number(languageProfileId);
    if (Number.isFinite(langId) && langId > 0) {
        body.languageProfileId = langId;
    }

    const result = await fetchArrInstance(instance, '/api/v3/series', {
        ...fetchOpts,
        method: 'POST',
        body,
        timeoutMs: 15000,
    });
    if (!result?.ok) {
        if (arrErrorLooksLike(result, /already been added|series.*exist|has already been added/i)) {
            const raced = await lookupSonarrSeriesForAdd(instance, {
                tmdbId: wantedTmdb || resolved.tmdbId,
                tvdbId,
                config,
                ...fetchOpts,
            });
            if (raced?.id) return claimExistingSeries(raced);
            return { ok: true, created: false, entity: raced || resolved, reason: 'Already in Sonarr' };
        }
        if (arrErrorLooksLike(result, /malformed|corrupt|disk image/i)) {
            return {
                ok: false,
                created: false,
                reason: 'Sonarr database is corrupted (SQLite malformed). Repair or restore sonarr.db, then retry.',
            };
        }
        return { ok: false, created: false, reason: arrErrorMessage(result, 'Failed to add series to Sonarr') };
    }
    if (search && result.data?.id) queueArrEntitySearch(instance, result.data, 'sonarr', fetchOpts);
    return { ok: true, created: true, entity: result.data };
};

export const fetchLidarrMetadataProfiles = async (instance, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 8000 } = {}) => {
    const payload = await fetchArrInstanceJson(instance, '/api/v1/metadataprofile', { resolveUrl, fetchImpl, timeoutMs });
    if (!Array.isArray(payload)) return [];
    return payload.map((entry) => ({
        id: Number(entry.id),
        name: String(entry.name || `Profile ${entry.id}`),
    })).filter((entry) => Number.isFinite(entry.id));
};

export const lookupLidarrArtist = async (instance, term, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 30000,
} = {}) => {
    const query = String(term || '').trim();
    if (!query || !isArrInstanceReady(instance)) return null;
    const payload = await fetchArrInstanceJson(
        instance,
        `/api/v1/artist/lookup?term=${encodeURIComponent(query)}`,
        { resolveUrl, fetchImpl, timeoutMs },
    );
    const list = Array.isArray(payload) ? payload : [];
    return list[0] || null;
};

export const findLidarrArtistInLibrary = async (instance, mbid, fetchOpts = {}) => {
    const id = String(mbid || '').trim();
    if (!id) return null;
    const catalog = await fetchArrInstanceJson(instance, '/api/v1/artist', fetchOpts);
    const list = Array.isArray(catalog) ? catalog : [];
    return list.find((entry) => String(entry?.foreignArtistId || '') === id)
        || list.find((entry) => String(entry?.artistMetadata?.foreignArtistId || '') === id)
        || null;
};

export const triggerLidarrArtistSearch = async (instance, artistId, { resolveUrl = (url) => url, fetchImpl = fetch, timeoutMs = 30000 } = {}) => {
    const id = Number(artistId || 0);
    if (!id) return { ok: false, reason: 'Missing Lidarr artist id' };
    const result = await fetchArrInstance(instance, '/api/v1/command', {
        resolveUrl,
        fetchImpl,
        method: 'POST',
        body: { name: 'ArtistSearch', artistId: id },
        timeoutMs,
    });
    if (!result?.ok) return { ok: false, reason: `Search command failed (${result?.status || 'unknown'})` };
    return { ok: true, commandId: result.data?.id || null };
};

/** Albums (release groups) Lidarr tracks for a library artist, with per-album stats. */
export const fetchLidarrAlbumsForArtist = async (instance, artistId, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 15000,
} = {}) => {
    const id = Number(artistId || 0);
    if (!id || !isArrInstanceReady(instance)) return [];
    const payload = await fetchArrInstanceJson(
        instance,
        `/api/v1/album?artistId=${id}`,
        { resolveUrl, fetchImpl, timeoutMs },
    );
    return Array.isArray(payload) ? payload : [];
};

export const setLidarrAlbumsMonitored = async (instance, albumIds, monitored, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 15000,
} = {}) => {
    const ids = (Array.isArray(albumIds) ? albumIds : [albumIds])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return { ok: false, reason: 'Missing Lidarr album ids' };
    const result = await fetchArrInstance(instance, '/api/v1/album/monitor', {
        resolveUrl,
        fetchImpl,
        method: 'PUT',
        body: { albumIds: ids, monitored: monitored !== false },
        timeoutMs,
    });
    if (!result?.ok) return { ok: false, reason: arrErrorMessage(result, 'Failed to update album monitoring') };
    return { ok: true };
};

export const triggerLidarrAlbumSearch = async (instance, albumIds, {
    resolveUrl = (url) => url,
    fetchImpl = fetch,
    timeoutMs = 30000,
} = {}) => {
    const ids = (Array.isArray(albumIds) ? albumIds : [albumIds])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return { ok: false, reason: 'Missing Lidarr album ids' };
    const result = await fetchArrInstance(instance, '/api/v1/command', {
        resolveUrl,
        fetchImpl,
        method: 'POST',
        body: { name: 'AlbumSearch', albumIds: ids },
        timeoutMs,
    });
    if (!result?.ok) return { ok: false, reason: `Search command failed (${result?.status || 'unknown'})` };
    return { ok: true, commandId: result.data?.id || null };
};

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Find a specific release group on a Lidarr library artist, retrying while
 * Lidarr populates album metadata after a fresh artist add.
 */
const findLidarrAlbumByMbid = async (instance, artistId, albumMbid, fetchOpts = {}, { attempts = 6, delayMs = 2500 } = {}) => {
    const target = String(albumMbid || '').trim();
    if (!target) return null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const albums = await fetchLidarrAlbumsForArtist(instance, artistId, fetchOpts).catch(() => []);
        const match = albums.find((album) => String(album?.foreignAlbumId || '') === target);
        if (match) return match;
        if (albums.length > 0 && attempt >= 2) return null; // metadata present, album genuinely missing
        if (attempt < attempts - 1) await waitMs(delayMs);
    }
    return null;
};

/** Monitor one album on an existing Lidarr artist and search for it. */
const monitorAndSearchLidarrAlbum = async (instance, artistEntity, albumMbid, fetchOpts = {}) => {
    const album = await findLidarrAlbumByMbid(instance, artistEntity?.id, albumMbid, fetchOpts);
    if (!album) {
        return {
            ok: false,
            created: false,
            reason: 'Lidarr does not list this album for the artist yet — try again shortly.',
        };
    }
    if (!album.monitored) {
        const monitorResult = await setLidarrAlbumsMonitored(instance, album.id, true, fetchOpts);
        if (!monitorResult.ok) return { ok: false, created: false, reason: monitorResult.reason };
    }
    await triggerLidarrAlbumSearch(instance, album.id, fetchOpts).catch(() => null);
    return { ok: true, created: false, entity: artistEntity, album };
};

/**
 * Add an artist to Lidarr (or return existing) and optionally search.
 * @returns {{ ok: boolean, created: boolean, entity?: object, reason?: string }}
 */
export const addLidarrArtist = async (instance, {
    mbid,
    albumMbid = null,
    qualityProfileId,
    metadataProfileId,
    rootFolderPath,
    tags = [],
    monitored = true,
    search = true,
    resolveUrl = (url) => url,
    fetchImpl = fetch,
} = {}) => {
    if (!isArrInstanceReady(instance)) return { ok: false, created: false, reason: 'Lidarr instance is not ready' };
    const profileId = Number(qualityProfileId);
    const folder = String(rootFolderPath || '').trim();
    const foreignId = String(mbid || '').trim();
    const targetAlbum = String(albumMbid || '').trim();
    if (!foreignId) return { ok: false, created: false, reason: 'MusicBrainz artist id is required' };
    if (!Number.isFinite(profileId) || !folder) {
        return { ok: false, created: false, reason: 'Quality profile and root folder are required' };
    }

    const fetchOpts = { resolveUrl, fetchImpl, timeoutMs: 20000 };
    const existing = await findLidarrArtistInLibrary(instance, foreignId, fetchOpts);
    if (existing?.id) {
        if (targetAlbum) return monitorAndSearchLidarrAlbum(instance, existing, targetAlbum, fetchOpts);
        if (search) void triggerLidarrArtistSearch(instance, existing.id, { ...fetchOpts, timeoutMs: 10000 }).catch(() => {});
        return { ok: true, created: false, entity: existing };
    }

    const lookup = await lookupLidarrArtist(instance, `mbid:${foreignId}`, fetchOpts);
    if (!lookup) return { ok: false, created: false, reason: 'Lidarr could not look up this artist' };

    let metaProfileId = Number(metadataProfileId);
    if (!Number.isFinite(metaProfileId)) {
        const profiles = await fetchLidarrMetadataProfiles(instance, fetchOpts);
        metaProfileId = Number(profiles[0]?.id);
    }
    if (!Number.isFinite(metaProfileId)) {
        return { ok: false, created: false, reason: 'No Lidarr metadata profile is configured' };
    }

    const body = {
        ...lookup,
        foreignArtistId: lookup.foreignArtistId || foreignId,
        qualityProfileId: profileId,
        metadataProfileId: metaProfileId,
        rootFolderPath: folder,
        // Album requests add the artist unmonitored, then monitor just that album.
        monitored: targetAlbum ? false : monitored !== false,
        tags: Array.isArray(tags) ? tags.map((t) => Number(t)).filter((n) => Number.isFinite(n)) : [],
        addOptions: targetAlbum
            ? { monitor: 'none', searchForMissingAlbums: false }
            : { searchForMissingAlbums: false },
    };

    const result = await fetchArrInstance(instance, '/api/v1/artist', {
        ...fetchOpts,
        method: 'POST',
        body,
    });
    if (!result?.ok) {
        if (arrErrorLooksLike(result, /already been added/i)) {
            const raced = await findLidarrArtistInLibrary(instance, foreignId, fetchOpts);
            if (raced?.id) {
                if (targetAlbum) return monitorAndSearchLidarrAlbum(instance, raced, targetAlbum, fetchOpts);
                if (search) void triggerLidarrArtistSearch(instance, raced.id, { ...fetchOpts, timeoutMs: 10000 }).catch(() => {});
                return { ok: true, created: false, entity: raced };
            }
        }
        return { ok: false, created: false, reason: arrErrorMessage(result, 'Failed to add artist to Lidarr') };
    }
    if (targetAlbum) {
        const albumResult = await monitorAndSearchLidarrAlbum(instance, result.data, targetAlbum, fetchOpts);
        return { ...albumResult, created: true, entity: result.data };
    }
    if (search && result.data?.id) {
        void triggerLidarrArtistSearch(instance, result.data.id, { ...fetchOpts, timeoutMs: 10000 }).catch(() => {});
    }
    return { ok: true, created: true, entity: result.data };
};
