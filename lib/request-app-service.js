import {
    hasActiveSeerrDownloads,
    isMediaActivelyProcessing,
} from './seerr-download-status.js';
import { createSeerrIssueService } from './seerr-issue-service.js';
import { createSeerrBlocklistService } from './seerr-blocklist-service.js';
import {
    applyMissingLibrarySeasonInference,
    isReturningSeries,
    isSeasonStillAiring,
    isSeasonUpToDateLabel,
    reconcileSeasonOptionsWithSonarr,
    resolveMonitoredSeasonLabel,
    resolvePartialSeasonLabel,
} from './seerr-season-status.js';
import { createLibraryAvailability } from './portal-request/libraryAvailability.js';
import { getPortalRequestDefaults } from './portal-request/portalRequestDefaults.js';
import {
    fetchArrInstance,
    getArrInstances,
    getDefaultArrInstance,
    isArrInstanceReady,
} from './arr-service.js';
import { inferServerIs4k, normalizeServerListIs4k } from './portal-request/portalArrServices.js';
import { detectAnimeMedia, inferAnimeRootFolderPath } from './portal-request/animeMedia.js';
import { watcherTitleKey, isWatchingTitle, notifyEligibility, summarizeOtherRequesters } from './notifications/requestWatchers.js';
import { evaluateSeerrMovieRequestability } from './seerr-movie-requestability.js';
import { cookieHeaderFromSetCookie } from './seerr-user-session.js';
import { createTtlLruCache } from './memory-cache.js';

export const isSeerrFamilyRequestApp = (type) => {
    const lower = String(type || '').toLowerCase();
    return lower === 'seerr' || lower === 'overseerr' || lower === 'jellyseerr';
};

export const isRequestAppConfigured = (config = {}) => {
    const type = String(config.requestAppType || 'none').toLowerCase();
    if (type === 'none' || !config.requestAppUrl || !config.requestAppApiKey) return false;
    return isSeerrFamilyRequestApp(type);
};

export const seerrRequestStatusLabel = (status) => {
    const value = Number(status);
    if (value === 1) return 'pending';
    if (value === 2) return 'approved';
    if (value === 3) return 'declined';
    if (value === 4) return 'failed';
    return 'unknown';
};

export const isPendingSeerrRequest = (reqItem) => Number(reqItem?.status) === 1;

export const isDeclinedSeerrRequest = (reqItem) => {
    const status = reqItem?.status;
    if (status === 3 || status === '3') return true;
    return String(status || '').toLowerCase() === 'declined';
};

export const isApprovedSeerrRequest = (reqItem) => {
    const status = reqItem?.status;
    if (status === 2 || status === '2') return true;
    return String(status || '').toLowerCase() === 'approved';
};

export const isFailedSeerrRequest = (reqItem) => {
    const status = reqItem?.status;
    if (status === 4 || status === '4') return true;
    return String(status || '').toLowerCase() === 'failed';
};

const parseSeerrTags = (tags) => {
    if (Array.isArray(tags)) return tags.map((t) => Number(t)).filter((n) => Number.isFinite(n));
    if (tags === 'none' || tags === null || tags === undefined) return [];
    if (typeof tags === 'string' && tags.trim()) {
        return tags.split(',').map((t) => Number(t.trim())).filter((n) => Number.isFinite(n));
    }
    return [];
};

const mapSeerrSeasons = (seasons) => {
    if (!Array.isArray(seasons)) return [];
    return seasons.map((s) => ({
        seasonNumber: Number(s?.seasonNumber ?? s?.season_number) || 0,
        status: Number(s?.status) || null,
        statusLabel: seerrRequestStatusLabel(s?.status),
    })).filter((s) => s.seasonNumber >= 0);
};

/** Paginate Seerr list results until enough items match (e.g. declined has no API filter). */
export const collectSeerrRequestsMatching = async ({
    fetchPage,
    apiFilter = 'all',
    sort = 'modified',
    matchFn,
    take = 20,
    skip = 0,
    pageSize = 50,
    maxPages = 50,
}) => {
    const matched = [];
    let pageSkip = 0;
    let totalResults = Number.POSITIVE_INFINITY;

    for (let page = 0; page < maxPages && matched.length < skip + take && pageSkip < totalResults; page += 1) {
        const payload = await fetchPage(apiFilter, sort, pageSize, pageSkip);
        const batch = Array.isArray(payload?.results) ? payload.results : [];
        const reportedTotal = Number(payload?.pageInfo?.results);
        if (Number.isFinite(reportedTotal) && reportedTotal >= 0) totalResults = reportedTotal;

        if (!batch.length) break;

        for (const item of batch) {
            if (matchFn(item)) matched.push(item);
        }

        pageSkip += batch.length;
        if (pageSkip >= totalResults) break;
    }

    return matched.slice(skip, skip + take);
};

/** Portal tab filters vs Seerr query/filter allowed values (no `declined` on Seerr). */
export const resolveSeerrListQuery = (portalFilter, take = 20) => {
    if (portalFilter === 'declined') {
        return { apiFilter: 'all', clientFilter: 'declined', take, paginate: true };
    }
    if (portalFilter === 'pending') {
        return { apiFilter: 'pending', clientFilter: 'pending', take };
    }
    if (portalFilter === 'approved') {
        return { apiFilter: 'approved', clientFilter: null, take };
    }
    if (portalFilter === 'processing') {
        return { apiFilter: 'processing', clientFilter: null, take };
    }
    if (portalFilter === 'available') {
        return { apiFilter: 'available', clientFilter: null, take };
    }
    if (portalFilter === 'failed') {
        return { apiFilter: 'failed', clientFilter: null, take };
    }
    return { apiFilter: portalFilter, clientFilter: null, take };
};

export const applyPortalRequestStatusFilter = (results, clientFilter) => {
    if (!clientFilter) return results;
    if (clientFilter === 'declined') return results.filter(isDeclinedSeerrRequest);
    if (clientFilter === 'pending') return results.filter(isPendingSeerrRequest);
    return results;
};

/** Jellyseerr / Seerr permission bit flags. */
export const SeerrPermission = {
    ADMIN: 2,
    MANAGE_USERS: 8,
    MANAGE_REQUESTS: 16,
    REQUEST: 32,
    AUTO_APPROVE: 128,
    AUTO_APPROVE_MOVIE: 256,
    AUTO_APPROVE_TV: 512,
    REQUEST_4K: 1024,
    REQUEST_4K_MOVIE: 2048,
    REQUEST_4K_TV: 4096,
    REQUEST_ADVANCED: 8192,
    REQUEST_VIEW: 16384,
    AUTO_APPROVE_4K: 32768,
    AUTO_APPROVE_4K_MOVIE: 65536,
    AUTO_APPROVE_4K_TV: 131072,
    REQUEST_MOVIE: 262144,
    REQUEST_TV: 524288,
    MANAGE_ISSUES: 1048576,
    VIEW_ISSUES: 2097152,
    CREATE_ISSUES: 4194304,
    AUTO_REQUEST: 8388608,
};

export const hasSeerrPermission = (permissions, ...bits) => {
    const value = Number(permissions) || 0;
    if ((value & SeerrPermission.ADMIN) === SeerrPermission.ADMIN) return true;
    if (!bits.length) return value > 0;
    return bits.some((bit) => (value & bit) === bit);
};

/** Managers bypass most request/issue UI gates. */
export const hasSeerrManageAccess = (permissions) => hasSeerrPermission(
    permissions,
    SeerrPermission.ADMIN,
    SeerrPermission.MANAGE_REQUESTS,
);

export const canSeerrRequestMedia = (permissions, mediaType) => {
    if (hasSeerrManageAccess(permissions)) return true;
    if (hasSeerrPermission(permissions, SeerrPermission.REQUEST)) return true;
    return mediaType === 'tv'
        ? hasSeerrPermission(permissions, SeerrPermission.REQUEST_TV)
        : hasSeerrPermission(permissions, SeerrPermission.REQUEST_MOVIE);
};

export const canSeerrRequest4k = (permissions, mediaType) => {
    if (hasSeerrManageAccess(permissions)) return true;
    if (hasSeerrPermission(permissions, SeerrPermission.REQUEST_4K)) return true;
    return mediaType === 'tv'
        ? hasSeerrPermission(permissions, SeerrPermission.REQUEST_4K_TV)
        : hasSeerrPermission(permissions, SeerrPermission.REQUEST_4K_MOVIE);
};

export const canSeerrCreateIssues = (permissions) => (
    hasSeerrPermission(
        permissions,
        SeerrPermission.CREATE_ISSUES,
        SeerrPermission.MANAGE_ISSUES,
        SeerrPermission.ADMIN,
    )
);

export const mapSeerrPermissionFlags = (permissions) => {
    const value = Number(permissions) || 0;
    return {
        request: canSeerrRequestMedia(value, 'movie') || canSeerrRequestMedia(value, 'tv'),
        requestMovie: canSeerrRequestMedia(value, 'movie'),
        requestTv: canSeerrRequestMedia(value, 'tv'),
        request4k: canSeerrRequest4k(value, 'movie') || canSeerrRequest4k(value, 'tv'),
        request4kMovie: canSeerrRequest4k(value, 'movie'),
        request4kTv: canSeerrRequest4k(value, 'tv'),
        requestAdvanced: hasSeerrPermission(value, SeerrPermission.REQUEST_ADVANCED) || hasSeerrManageAccess(value),
        requestTags: true,
        createIssues: canSeerrCreateIssues(value),
        viewIssues: hasSeerrPermission(value, SeerrPermission.VIEW_ISSUES, SeerrPermission.MANAGE_ISSUES, SeerrPermission.ADMIN),
        autoApprove: hasSeerrPermission(value, SeerrPermission.AUTO_APPROVE, SeerrPermission.AUTO_APPROVE_MOVIE, SeerrPermission.AUTO_APPROVE_TV),
        autoApprove4k: hasSeerrPermission(value, SeerrPermission.AUTO_APPROVE_4K, SeerrPermission.AUTO_APPROVE_4K_MOVIE, SeerrPermission.AUTO_APPROVE_4K_TV),
    };
};

/** Map raw Seerr / network errors into member-friendly messages + HTTP status. */
export const mapSeerrClientError = (rawMessage, statusHint = null) => {
    const message = String(rawMessage || '').trim();
    const lower = message.toLowerCase();
    const hint = Number(statusHint) || null;

    if (/quota|limit exceeded|used all|request limit/i.test(lower)) {
        return { status: 429, error: 'You have reached your request quota for this period.' };
    }
    if (/already requested|already exists|duplicate/i.test(lower)) {
        return { status: 409, error: 'This title has already been requested.' };
    }
    if (/blacklist|blocklist|not allowed to request/i.test(lower)) {
        return { status: 403, error: 'This title is blocked from requests.' };
    }
    if (/sign in with plex|seerr session/i.test(lower)) {
        return { status: 403, error: message };
    }
    if (hint === 403 || /permission|not authorized|forbidden|do not have permission/i.test(lower)) {
        return { status: 403, error: 'You do not have permission to do that.' };
    }
    if (hint === 401 || /api key|unauthorized/i.test(lower)) {
        return { status: 502, error: 'Request app authentication failed. Ask your admin to check the API key.' };
    }
    if (/cannot reach request app|network error|fetch failed|econnrefused|etimedout/i.test(lower)) {
        return { status: 502, error: 'Could not reach the request app. Try again in a moment.' };
    }
    return {
        status: hint && hint >= 400 ? hint : 502,
        error: message || 'Request failed.',
    };
};

const mapQuotaSlot = (slot) => {
    if (!slot || typeof slot !== 'object') {
        return { limit: 0, days: 7, used: 0, remaining: null };
    }
    const limit = Number(slot.quotaLimit ?? slot.limit) || 0;
    const days = Number(slot.quotaDays ?? slot.days) || 7;
    const used = Number(slot.quotaUsed ?? slot.used) || 0;
    const remaining = limit === 0 ? null : Math.max(0, limit - used);
    return { limit, days, used, remaining };
};

export const mapSeerrQuotaResponse = (quota, mediaType) => {
    if (!quota || typeof quota !== 'object') {
        return { standard: mapQuotaSlot(null), fourK: mapQuotaSlot(null) };
    }
    const standardKey = mediaType === 'tv' ? 'tv' : 'movie';
    const fourKKeys = mediaType === 'tv'
        ? ['4ktv', '4kTv', '4k_tv']
        : ['4kmovie', '4kMovie', '4k_movie'];
    let fourKSlot = null;
    for (const key of fourKKeys) {
        if (quota[key]) {
            fourKSlot = quota[key];
            break;
        }
    }
    if (!fourKSlot && quota['4k']) fourKSlot = quota['4k'];
    return {
        standard: mapQuotaSlot(quota[standardKey]),
        fourK: mapQuotaSlot(fourKSlot),
    };
};

export const mapFullSeerrQuota = (quota) => ({
    movie: mapSeerrQuotaResponse(quota, 'movie'),
    tv: mapSeerrQuotaResponse(quota, 'tv'),
});

export const buildMemberSeasonOptions = (details = {}, mediaInfo = {}) => {
    const tmdbSeasons = Array.isArray(details?.seasons) ? details.seasons : [];
    const librarySeasons = Array.isArray(mediaInfo?.seasons) ? mediaInfo.seasons : [];
    const libraryByNum = new Map(
        librarySeasons.map((s) => [Number(s?.seasonNumber ?? s?.season_number), Number(s?.status) || null]),
    );

    const requestedSeasonStatus = new Map();
    const requests = Array.isArray(mediaInfo?.requests) ? mediaInfo.requests : [];
    for (const req of requests) {
        if (!Array.isArray(req?.seasons)) continue;
        const reqStatus = Number(req?.status);
        for (const season of req.seasons) {
            const num = Number(season?.seasonNumber ?? season?.season_number);
            if (!Number.isFinite(num)) continue;
            const existing = requestedSeasonStatus.get(num);
            if (existing == null || reqStatus === 1) requestedSeasonStatus.set(num, reqStatus);
        }
    }

    const rows = applyMissingLibrarySeasonInference(details, mediaInfo, tmdbSeasons
        .filter((s) => Number(s?.seasonNumber ?? s?.season_number) >= 0)
        .sort((a, b) => Number(a?.seasonNumber ?? a?.season_number) - Number(b?.seasonNumber ?? b?.season_number))
        .map((s) => {
            const seasonNumber = Number(s?.seasonNumber ?? s?.season_number);
            const libraryStatus = libraryByNum.get(seasonNumber) ?? null;
            const requestStatus = requestedSeasonStatus.get(seasonNumber) ?? null;

            let requestable = true;
            let statusLabel = 'Not requested';

            if (libraryStatus === 5) {
                requestable = false;
                statusLabel = 'Available';
            } else if (libraryStatus === 3) {
                requestable = false;
                const fallback = hasActiveSeerrDownloads(mediaInfo, { seasonNumber })
                    ? 'Processing'
                    : 'Requested';
                statusLabel = resolveMonitoredSeasonLabel(details, seasonNumber, fallback);
            } else if (libraryStatus === 2) {
                requestable = false;
                statusLabel = 'Pending';
            } else if (libraryStatus === 4) {
                requestable = false;
                statusLabel = resolvePartialSeasonLabel(details, seasonNumber);
            } else if (requestStatus === 1) {
                requestable = false;
                statusLabel = 'Pending';
            } else if (requestStatus === 2) {
                requestable = false;
                statusLabel = resolveMonitoredSeasonLabel(details, seasonNumber, 'Approved');
            } else if (requestStatus === 3) {
                requestable = false;
                statusLabel = 'Declined';
            } else if (requestStatus === 4) {
                requestable = false;
                statusLabel = 'Failed';
            }

            return {
                seasonNumber,
                name: s?.name || (seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`),
                episodeCount: Number(s?.episodeCount ?? s?.episode_count) || 0,
                posterPath: s?.posterPath ?? s?.poster_path ?? null,
                libraryStatus,
                requestStatus,
                statusLabel,
                requestable,
            };
        }));
    return reconcileSeasonOptionsWithSonarr(details, rows);
};

export const isMemberRequestMediaAvailable = (reqItem = {}) => {
    if (reqItem?.isDownloading) return false;
    const mediaStatus = Number(reqItem?.media?.status ?? reqItem?.mediaStatus);
    if (mediaStatus === 4 || mediaStatus === 5) return true;
    if (mediaStatus === 3) {
        const media = reqItem?.media || {};
        const type = resolveSeerrRequestType(reqItem, media);
        if (type === 'tv' && !hasActiveSeerrDownloads(media, { is4k: !!reqItem?.is4k })) return true;
    }
    return false;
};

/** Portal tab filters for a member's own Seerr requests. */
export const filterMemberRequestTab = (reqItem, filter) => {
    const status = Number(reqItem?.status);
    if (filter === 'all') return true;
    if (filter === 'pending') return status === 1;
    if (filter === 'declined') return status === 3 || isDeclinedSeerrRequest(reqItem);
    if (filter === 'failed') return status === 4 || isFailedSeerrRequest(reqItem);
    if (filter === 'available') return status === 2 && isMemberRequestMediaAvailable(reqItem);
    if (filter === 'approved') return status === 2 && !isMemberRequestMediaAvailable(reqItem);
    return true;
};

export const deduplicateMemberRequests = (items = []) => {
    const deduped = [];
    const seen = new Set();
    for (const item of items) {
        const tmdbId = item?.media?.tmdbId || item?.tmdbId;
        const type = item?.media?.mediaType || item?.type || resolveSeerrRequestType(item, item?.media || {});
        if (tmdbId && type) {
            const key = `${type}-${tmdbId}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(item);
            }
        } else {
            deduped.push(item);
        }
    }
    return deduped;
};

export const countMemberRequests = (items = []) => {
    const counts = { pending: 0, approved: 0, available: 0, declined: 0, failed: 0, total: 0 };
    for (const item of items) {
        counts.total += 1;
        if (filterMemberRequestTab(item, 'pending')) counts.pending += 1;
        if (filterMemberRequestTab(item, 'approved')) counts.approved += 1;
        if (filterMemberRequestTab(item, 'available')) counts.available += 1;
        if (filterMemberRequestTab(item, 'declined')) counts.declined += 1;
        if (filterMemberRequestTab(item, 'failed')) counts.failed += 1;
    }
    return counts;
};

export const memberRequestDisplayStatus = (item = {}) => {
    const status = Number(item?.status);
    const mediaStatus = Number(item?.mediaStatus ?? item?.media?.status);
    const media = item?.media || {};
    const is4k = !!item?.is4k;
    if (status === 3) return 'Declined';
    if (status === 4) return 'Failed';
    if (status === 1) return 'Pending Approval';
    if (status === 2 && item?.isDownloading) return 'Processing';
    if (status === 2 && (mediaStatus === 4 || mediaStatus === 5)) return 'Available';
    if (status === 2 && mediaStatus === 3) {
        const type = resolveSeerrRequestType(item, media);
        if (hasActiveSeerrDownloads(media, { is4k })) return 'Processing';
        if (type === 'tv') return 'Available';
        return 'Requested';
    }
    if (status === 2) return 'Approved';
    return seerrRequestStatusLabel(status) || 'Unknown';
};

export const normalizeWatchlistTarget = (item = {}) => {
    const media = item?.media && typeof item.media === 'object' ? item.media : item;
    let mediaType = media?.mediaType ?? item?.mediaType ?? item?.type;
    if (mediaType === 2 || mediaType === '2') mediaType = 'tv';
    if (mediaType === 1 || mediaType === '1') mediaType = 'movie';
    if (!mediaType && media?.firstAirDate) mediaType = 'tv';
    if (!mediaType && (media?.title || media?.name) && media?.releaseDate) mediaType = 'movie';
    const type = mediaType === 'tv' ? 'tv' : mediaType === 'movie' ? 'movie' : null;
    const mediaId = Number(media?.tmdbId ?? media?.id ?? item?.id);
    if (!type || !Number.isFinite(mediaId) || mediaId <= 0) return null;
    const title = media?.title || media?.name || item?.title || item?.name || 'Unknown title';
    return { mediaType: type, mediaId, title };
};

export const resolveSeerrRequestType = (reqItem = {}, media = {}) => {
    const raw = String(reqItem?.type ?? media?.mediaType ?? media?.type ?? '').toLowerCase().trim();
    if (raw === 'tv' || raw === 'show' || raw === 'series' || raw === 'anime' || raw === '2') return 'tv';
    if (media?.firstAirDate || reqItem?.firstAirDate) return 'tv';
    if (reqItem?.seasons === 'all' || (Array.isArray(reqItem?.seasons) && reqItem.seasons.length)) return 'tv';
    return 'movie';
};

const parseSeerrCountPayload = (payload = {}) => {
    const source = payload?.requests && typeof payload.requests === 'object' ? payload.requests : payload;
    const pending = Number(source?.pending);
    const approved = Number(source?.approved);
    const declined = Number(source?.declined);
    const total = Number(source?.total);
    const processing = Number(source?.processing);
    const available = Number(source?.available);
    const failed = Number(source?.failed);
    const completed = Number(source?.completed);
    return {
        pending: Number.isFinite(pending) ? pending : 0,
        approved: Number.isFinite(approved) ? approved : 0,
        declined: Number.isFinite(declined) ? declined : 0,
        processing: Number.isFinite(processing) ? processing : 0,
        available: Number.isFinite(available) ? available : 0,
        failed: Number.isFinite(failed) ? failed : null,
        completed: Number.isFinite(completed) ? completed : 0,
        total: Number.isFinite(total) ? total : 0,
    };
};

const fetchSeerrFailedRequestCount = async (fetchSeerrJson, config) => {
    const params = new URLSearchParams({ filter: 'failed', take: '1', skip: '0', sort: 'modified' });
    const payload = await fetchSeerrJson(config, `/api/v1/request?${params.toString()}`);
    const failedTotal = Number(payload?.pageInfo?.results);
    return Number.isFinite(failedTotal) && failedTotal >= 0 ? failedTotal : 0;
};

const TMDB_POSTER_SIZE = 'w342';
const TMDB_BACKDROP_SIZE = 'w1280';

export const buildTmdbPosterUrl = (posterPath, size = TMDB_POSTER_SIZE) => {
    if (!posterPath) return '';
    const raw = String(posterPath);
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `https://image.tmdb.org/t/p/${size}${path}`;
};

/** Seerr imageproxy expects /imageproxy/tmdb/t/p/{size}/{file} — not /poster/ */
export const buildSeerrPosterUrl = (baseUrl, posterPath, size = TMDB_POSTER_SIZE) => {
    if (!posterPath) return '';
    const raw = String(posterPath);
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    const cleanBase = String(baseUrl || '').replace(/\/$/, '');
    return `${cleanBase}/imageproxy/tmdb/t/p/${size}${path}`;
};

export const buildRequestPosterUrl = (posterPath, seerrBaseUrl) => (
    buildTmdbPosterUrl(posterPath) || buildSeerrPosterUrl(seerrBaseUrl, posterPath)
);

export const buildTmdbBackdropUrl = (backdropPath, size = TMDB_BACKDROP_SIZE) => {
    if (!backdropPath) return '';
    const raw = String(backdropPath);
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `https://image.tmdb.org/t/p/${size}${path}`;
};

export const buildSeerrBackdropUrl = (baseUrl, backdropPath, size = TMDB_BACKDROP_SIZE) => {
    if (!backdropPath) return '';
    const raw = String(backdropPath);
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    const cleanBase = String(baseUrl || '').replace(/\/$/, '');
    return `${cleanBase}/imageproxy/tmdb/t/p/${size}${path}`;
};

export const buildRequestBackdropUrl = (backdropPath, seerrBaseUrl) => (
    buildTmdbBackdropUrl(backdropPath) || buildSeerrBackdropUrl(seerrBaseUrl, backdropPath)
);

const seerrMediaCacheKey = (type, tmdbId) => `${type}:${tmdbId}`;

const requestNeedsMediaEnrichment = (reqItem) => {
    const media = reqItem?.media || {};
    const hasTitle = !!(media.title || media.name || reqItem?.title || reqItem?.name);
    const hasPoster = !!(media.posterPath || media.poster);
    const hasBackdrop = !!(media.backdropPath || media.backdrop);
    const hasGenres = Array.isArray(media.genres) && media.genres.length > 0;
    const hasLanguage = !!(media.originalLanguage || media.original_language);
    if (!(Number(media.tmdbId) > 0)) return false;
    return !hasTitle || !hasPoster || !hasBackdrop || !hasGenres || !hasLanguage;
};

export const enrichSeerrRequestResults = async (fetchSeerrJson, config, results) => {
    if (!Array.isArray(results) || results.length === 0) return results;

    const keysToFetch = new Map();
    for (const item of results) {
        if (!requestNeedsMediaEnrichment(item)) continue;
        const media = item?.media || {};
        const type = resolveSeerrRequestType(item, media);
        const tmdbId = Number(media.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
        const key = seerrMediaCacheKey(type, tmdbId);
        if (!keysToFetch.has(key)) keysToFetch.set(key, { type, tmdbId });
    }

    if (keysToFetch.size === 0) return results;

    const detailsCache = new Map();
    await Promise.all([...keysToFetch.entries()].map(async ([key, { type, tmdbId }]) => {
        const segment = type === 'tv' ? 'tv' : 'movie';
        const details = await fetchSeerrJson(config, `/api/v1/${segment}/${tmdbId}`).catch(() => null);
        if (details) detailsCache.set(key, details);
    }));

    if (detailsCache.size === 0) return results;

    return results.map((item) => {
        if (!requestNeedsMediaEnrichment(item)) return item;
        const media = item?.media || {};
        const type = resolveSeerrRequestType(item, media);
        const tmdbId = Number(media.tmdbId);
        const details = detailsCache.get(seerrMediaCacheKey(type, tmdbId));
        if (!details) return item;
        return {
            ...item,
            media: {
                ...media,
                title: details.title || media.title,
                name: details.name || media.name,
                posterPath: details.posterPath || media.posterPath,
                backdropPath: details.backdropPath || media.backdropPath,
                overview: details.overview || media.overview,
                genres: details.genres || media.genres,
                originalLanguage: details.originalLanguage || details.original_language || media.originalLanguage,
                releaseDate: details.releaseDate || media.releaseDate,
                firstAirDate: details.firstAirDate || media.firstAirDate,
                mediaType: details.mediaType || media.mediaType || type,
            },
        };
    });
};

export const mapSeerrRequestToDto = (reqItem, baseUrl) => {
    const media = reqItem?.media || {};
    const requestedBy = reqItem?.requestedBy || {};
    const posterPath = media.posterPath || media.poster || '';
    const backdropPath = media.backdropPath || media.backdrop || '';
    const title = media.title || media.name || reqItem?.title || reqItem?.name || 'Unknown title';
    const yearSource = media.releaseDate || media.firstAirDate || '';
    const cleanBase = String(baseUrl || '').replace(/\/$/, '');
    const type = resolveSeerrRequestType(reqItem, media);
    const status = Number(reqItem?.status) || null;
    const tmdbId = Number(media.tmdbId) || null;
    const is4k = !!reqItem?.is4k;
    const isDownloading = hasActiveSeerrDownloads(media, { is4k });

    const routingParts = [];
    if (reqItem?.profileName) routingParts.push(reqItem.profileName);
    else if (reqItem?.profileId) routingParts.push(`Profile #${reqItem.profileId}`);
    if (reqItem?.rootFolder) routingParts.push(reqItem.rootFolder);

    return {
        id: reqItem?.id,
        status,
        statusLabel: seerrRequestStatusLabel(reqItem?.status),
        type,
        is4k: !!reqItem?.is4k,
        title,
        year: yearSource ? String(yearSource).slice(0, 4) : null,
        overview: media.overview || '',
        genres: Array.isArray(media.genres)
            ? media.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
            : [],
        originalLanguage: media.originalLanguage || media.original_language || null,
        posterUrl: buildRequestPosterUrl(posterPath, cleanBase),
        backdropUrl: buildRequestBackdropUrl(backdropPath, cleanBase),
        requestedBy: {
            id: requestedBy.id || null,
            displayName: requestedBy.displayName || requestedBy.username || requestedBy.email || 'Unknown',
            email: requestedBy.email || null,
            plexId: requestedBy.plexId ?? null,
            avatar: requestedBy.avatar
            ? (String(requestedBy.avatar).startsWith('http')
                ? requestedBy.avatar
                : `${cleanBase}${String(requestedBy.avatar).startsWith('/') ? requestedBy.avatar : `/${requestedBy.avatar}`}`)
            : '',
        },
        modifiedBy: reqItem?.modifiedBy?.id ? {
            id: reqItem.modifiedBy.id,
            displayName: reqItem.modifiedBy.displayName || reqItem.modifiedBy.username || 'Unknown',
        } : null,
        declineReason: reqItem?.reason || reqItem?.declineReason || null,
        createdAt: reqItem?.createdAt || null,
        updatedAt: reqItem?.updatedAt || null,
        mediaStatus: media.status ?? null,
        isDownloading,
        seerrUrl: `${cleanBase}/requests`,
        tmdbId,
        mediaId: Number(media.id) || null,
        serverId: reqItem?.serverId ?? null,
        profileId: reqItem?.profileId ?? null,
        profileName: reqItem?.profileName || null,
        rootFolder: reqItem?.rootFolder || null,
        languageProfileId: reqItem?.languageProfileId ?? null,
        tags: parseSeerrTags(reqItem?.tags),
        seasons: mapSeerrSeasons(reqItem?.seasons),
        routingSummary: routingParts.length ? routingParts.join(' · ') : null,
        canRemove: reqItem?.canRemove ?? null,
        canRetry: status === 4 || isFailedSeerrRequest(reqItem),
        isAnime: !!media?.isAnime,
        posterPath: posterPath || null,
        canCancel: Number(reqItem?.status) === 1,
    };
};

export const buildSeerrUpdateBody = (detail, overrides = {}) => {
    const type = detail?.type || 'movie';
    const mediaType = type === 'tv' ? 'tv' : 'movie';
    const body = { mediaType };

    if (overrides.serverId != null) body.serverId = Number(overrides.serverId);
    if (overrides.profileId != null) body.profileId = Number(overrides.profileId);
    if (overrides.rootFolder != null) body.rootFolder = String(overrides.rootFolder);
    if (overrides.languageProfileId != null) body.languageProfileId = Number(overrides.languageProfileId);
    if (overrides.userId != null) body.userId = Number(overrides.userId);
    if (Array.isArray(overrides.tags)) body.tags = overrides.tags.map((t) => Number(t)).filter((n) => Number.isFinite(n));
    if (type === 'tv' && Array.isArray(overrides.seasons)) {
        body.seasons = overrides.seasons.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    }

    return body;
};

export const hasRequestOverrides = (overrides = {}) => (
    overrides.serverId != null
    || overrides.profileId != null
    || overrides.rootFolder != null
    || overrides.languageProfileId != null
    || overrides.userId != null
    || Array.isArray(overrides.tags)
    || Array.isArray(overrides.seasons)
);

export const getRequestAppGate = (config = {}) => {
    if (!isRequestAppConfigured(config)) {
        return {
            configured: false,
            supported: false,
            ready: false,
            error: 'Set Request App Type, URL, and API key under Settings → Integrations.',
        };
    }
    if (!isSeerrFamilyRequestApp(config.requestAppType)) {
        return {
            configured: true,
            supported: false,
            ready: false,
            error: 'In-portal approval supports Seerr, Overseerr, and Jellyseerr only (not Ombi).',
        };
    }
    return { configured: true, supported: true, ready: true, error: null };
};

export const createRequestAppService = ({
    fetchWithTimeout,
    resolveIntegrationUrlForFetch,
    resolveRequestAppFetchUrl,
    resolveMemberPlexToken = async () => null,
} = {}) => {
    const getCredentials = (config) => {
        if (!isRequestAppConfigured(config)) {
            throw new Error('Request app is not configured for in-portal approval');
        }
        const publicBaseUrl = resolveIntegrationUrlForFetch(config.requestAppUrl);
        const baseUrl = resolveRequestAppFetchUrl
            ? resolveRequestAppFetchUrl(config)
            : publicBaseUrl;
        return {
            type: String(config.requestAppType || 'none').toLowerCase(),
            baseUrl,
            publicBaseUrl,
            apiKey: config.requestAppApiKey,
        };
    };

    const seerrHeaders = (apiKey, extraHeaders = {}) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        ...extraHeaders,
    });

    const fetchSeerrJson = async (config, path, { method = 'GET', body = null, timeoutMs = 15000, headers = {}, cookie = null } = {}) => {
        const { baseUrl, publicBaseUrl, apiKey } = getCredentials(config);
        const requestHeaders = cookie
            ? {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Cookie: cookie,
                ...headers,
            }
            : seerrHeaders(apiKey, headers);
        let response;
        try {
            response = await fetchWithTimeout(`${baseUrl}${path}`, {
                method,
                headers: requestHeaders,
                ...(body ? { body: JSON.stringify(body) } : {}),
            }, timeoutMs);
        } catch (err) {
            const code = err?.cause?.code || err?.code || err?.message || 'network error';
            const usingPublicOnly = publicBaseUrl === baseUrl;
            const dockerHint = /localhost|127\.0\.0\.1/i.test(baseUrl)
                ? ' If the portal runs in Docker, use your server LAN IP or docker service name instead of localhost.'
                : '';
            const proxyHint = usingPublicOnly && /^https:\/\//i.test(baseUrl)
                ? ' Public reverse-proxy URLs often fail from inside Docker — set an Internal fetch URL (docker network name or LAN IP) under Settings → Integrations.'
                : '';
            throw new Error(`Cannot reach request app at ${baseUrl}.${dockerHint}${proxyHint} (${code})`);
        }
        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) {
            const message = data?.message || data?.error || `Request app returned HTTP ${response.status}`;
            const err = new Error(
                response.status === 401 || response.status === 403
                    ? `${message} — check the API key has MANAGE_REQUESTS permission.`
                    : message,
            );
            err.status = response.status;
            throw err;
        }
        if (response.status === 204) return { success: true };
        return data;
    };

    const fetchSeerrOptional = async (config, path, { method = 'GET', body = null, timeoutMs = 15000 } = {}) => {
        const { baseUrl, publicBaseUrl, apiKey } = getCredentials(config);
        let response;
        try {
            response = await fetchWithTimeout(`${baseUrl}${path}`, {
                method,
                headers: seerrHeaders(apiKey),
                ...(body ? { body: JSON.stringify(body) } : {}),
            }, timeoutMs);
        } catch (err) {
            const code = err?.cause?.code || err?.code || err?.message || 'network error';
            const usingPublicOnly = publicBaseUrl === baseUrl;
            const dockerHint = /localhost|127\.0\.0\.1/i.test(baseUrl)
                ? ' If the portal runs in Docker, use your server LAN IP or docker service name instead of localhost.'
                : '';
            const proxyHint = usingPublicOnly && /^https:\/\//i.test(baseUrl)
                ? ' Public reverse-proxy URLs often fail from inside Docker — set an Internal fetch URL (docker network name or LAN IP) under Settings → Integrations.'
                : '';
            return {
                ok: false,
                status: 0,
                data: null,
                error: `Cannot reach request app at ${baseUrl}.${dockerHint}${proxyHint} (${code})`,
            };
        }
        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                data,
                error: data?.message || data?.error || `Request app returned HTTP ${response.status}`,
            };
        }
        if (response.status === 204) {
            return { ok: true, status: response.status, data: { success: true }, error: null };
        }
        return { ok: true, status: response.status, data, error: null };
    };

    const findSeerrRequestById = async (config, requestId) => {
        for (let skip = 0; skip < 1000; skip += 50) {
            const params = new URLSearchParams({ take: '50', skip: String(skip), sort: 'modified', filter: 'all' });
            const payload = await fetchSeerrJson(config, `/api/v1/request?${params.toString()}`);
            const batch = Array.isArray(payload?.results) ? payload.results : [];
            const found = batch.find((r) => String(r?.id) === String(requestId));
            if (found) return found;
            if (batch.length < 50) break;
        }
        return null;
    };

    const listRequests = async (config, { filter = 'pending', take = 20, skip = 0, sort = 'added', enrich = true } = {}) => {
        const { publicBaseUrl, baseUrl } = getCredentials(config);
        const linkBaseUrl = publicBaseUrl || baseUrl;
        const { apiFilter, clientFilter, take: pageTake, paginate } = resolveSeerrListQuery(filter, take);
        const fetchPage = async (filterValue, sortValue, batchTake, batchSkip) => {
            const params = new URLSearchParams({
                take: String(batchTake),
                skip: String(batchSkip),
                sort: sortValue,
            });
            if (filterValue) params.set('filter', filterValue);
            return fetchSeerrJson(config, `/api/v1/request?${params.toString()}`);
        };

        let payload;
        let results;

        if (paginate && clientFilter === 'declined') {
            results = await collectSeerrRequestsMatching({
                fetchPage,
                apiFilter: 'all',
                sort: 'modified',
                matchFn: isDeclinedSeerrRequest,
                take: pageTake,
                skip,
            });
            payload = { pageInfo: { pages: 1, results: results.length, page: 1 } };
        } else {
            payload = await fetchPage(apiFilter, sort, pageTake, skip);
            results = Array.isArray(payload?.results) ? payload.results : [];

            if (filter === 'pending' && results.length === 0) {
                const fallbackPayload = await fetchPage('all', 'added', pageTake, skip).catch(() => null);
                const fallbackResults = Array.isArray(fallbackPayload?.results) ? fallbackPayload.results : [];
                results = fallbackResults.filter(isPendingSeerrRequest);
                if (results.length > 0) payload = fallbackPayload;
            }

            if (clientFilter) {
                results = applyPortalRequestStatusFilter(results, clientFilter).slice(0, pageTake);
            }
        }

        if (enrich !== false) {
            results = await enrichSeerrRequestResults(fetchSeerrJson, config, results);
        }

        const pageInfo = payload?.pageInfo || {};
        return {
            results: results.map((item) => mapSeerrRequestToDto(item, linkBaseUrl)),
            pageInfo: {
                pages: Number(pageInfo.pages) || 1,
                results: Number(pageInfo.results) || results.length,
                page: Number(pageInfo.page) || 1,
            },
        };
    };

    const getRequestCounts = async (config, { includeFailed = true } = {}) => {
        const payload = await fetchSeerrJson(config, '/api/v1/request/count');
        const counts = parseSeerrCountPayload(payload);
        if (includeFailed === false) {
            counts.failed = counts.failed ?? 0;
            return counts;
        }
        if (counts.failed == null) {
            counts.failed = await fetchSeerrFailedRequestCount(fetchSeerrJson, config).catch(() => 0);
        }
        return counts;
    };

    const getRequest = async (config, requestId) => {
        const { publicBaseUrl, baseUrl } = getCredentials(config);
        const linkBaseUrl = publicBaseUrl || baseUrl;
        let raw = await fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}`).catch(() => null);
        if (!raw?.media) {
            const fromList = await findSeerrRequestById(config, requestId);
            if (fromList) {
                raw = { ...fromList, ...raw, media: fromList.media || raw?.media, seasons: fromList.seasons || raw?.seasons };
            }
        }
        if (!raw) throw new Error('Request not found');
        const enriched = await enrichSeerrRequestResults(fetchSeerrJson, config, [raw]);
        const item = enriched[0] || raw;
        const dto = mapSeerrRequestToDto(item, linkBaseUrl);

        if (dto.type === 'tv' && dto.tmdbId) {
            try {
                const tvDetails = await fetchSeerrJson(config, `/api/v1/tv/${dto.tmdbId}`);
                dto.isAnime = detectAnimeMedia(tvDetails, { mediaType: 'tv' });
                dto.tvSeasons = Array.isArray(tvDetails?.seasons)
                    ? tvDetails.seasons.map((s) => ({
                        seasonNumber: Number(s?.seasonNumber ?? s?.season_number) || 0,
                        name: s?.name || `Season ${s?.seasonNumber ?? s?.season_number}`,
                        episodeCount: Number(s?.episodeCount ?? s?.episode_count) || 0,
                    }))
                    : [];
            } catch {
                dto.tvSeasons = dto.seasons.map((s) => ({
                    seasonNumber: s.seasonNumber,
                    name: s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`,
                    episodeCount: 0,
                }));
            }
        }

        return dto;
    };

    const listServiceServers = async (config, type) => {
        const segment = type === 'movie' || type === 'radarr' ? 'radarr' : 'sonarr';
        const servers = await fetchSeerrJson(config, `/api/v1/service/${segment}`);
        return normalizeServerListIs4k((Array.isArray(servers) ? servers : []).map((s) => ({
            id: s.id,
            name: s.name,
            is4k: inferServerIs4k(s),
            isDefault: !!s.isDefault,
        })));
    };

    const getServiceOptions = async (config, type, serverId) => {
        const segment = type === 'movie' || type === 'radarr' ? 'radarr' : 'sonarr';
        const data = await fetchSeerrJson(config, `/api/v1/service/${segment}/${encodeURIComponent(serverId)}`);
        const server = data?.server || {};
        const rootFolders = (data?.rootFolders || []).map((f) => ({
            id: f.id,
            path: f.path,
            freeSpace: f.freeSpace ?? null,
        }));
        return {
            server: {
                id: server.id,
                name: server.name,
                is4k: inferServerIs4k(server),
                isDefault: !!server.isDefault,
                activeProfileId: server.activeProfileId ?? null,
                activeDirectory: server.activeDirectory || null,
                activeLanguageProfileId: server.activeLanguageProfileId ?? null,
                activeAnimeProfileId: server.activeAnimeProfileId ?? null,
                activeAnimeDirectory: server.activeAnimeDirectory
                    || inferAnimeRootFolderPath(rootFolders)
                    || null,
                activeAnimeLanguageProfileId: server.activeAnimeLanguageProfileId ?? null,
            },
            profiles: (data?.profiles || []).map((p) => ({ id: p.id, name: p.name })),
            rootFolders,
            languageProfiles: (data?.languageProfiles || []).map((lp) => ({ id: lp.id, name: lp.name })),
            tags: (data?.tags || []).map((t) => ({ id: t.id, label: t.label || t.name || String(t.id) })),
        };
    };

    const routingError = (message, status = 400) => {
        const err = new Error(message);
        err.status = status;
        return err;
    };

    /** Ensure member-submitted Arr routing fields exist on the selected Seerr server. */
    const validateMemberRequestRouting = async (config, {
        mediaType,
        is4k = false,
        servers = [],
        serverId,
        profileId,
        rootFolder,
        languageProfileId,
        tags,
    } = {}) => {
        let sid = Number(serverId);
        if (!Number.isFinite(sid)) throw routingError('A valid serverId is required for advanced request options.');

        const allowedServers = Array.isArray(servers) ? servers : [];
        const want4k = !!is4k;

        // If override defaults / stale UI pointed at the wrong quality pool, remap.
        const listed = allowedServers.find((s) => Number(s.id) === sid);
        if (listed && !!listed.is4k !== want4k) {
            const remapped = allowedServers.find((s) => !!s.is4k === want4k);
            if (remapped) sid = Number(remapped.id);
        } else if (!listed && allowedServers.length) {
            const remapped = allowedServers.find((s) => !!s.is4k === want4k)
                || allowedServers.find((s) => s.isDefault)
                || allowedServers[0];
            if (remapped) sid = Number(remapped.id);
        }

        let options;
        try {
            options = await getServiceOptions(config, mediaType, sid);
        } catch {
            throw routingError('Selected server is not allowed for this title.', 403);
        }

        const serverIs4k = !!options.server?.is4k;
        if (want4k && !serverIs4k && allowedServers.some((s) => s.is4k)) {
            throw routingError('Selected server is not a 4K server.', 403);
        }
        if (!want4k && serverIs4k && allowedServers.some((s) => !s.is4k)) {
            // Remap one more time from live flag if needed
            const hd = allowedServers.find((s) => !s.is4k);
            if (hd) {
                sid = Number(hd.id);
                options = await getServiceOptions(config, mediaType, sid);
            } else {
                throw routingError('Selected server is a 4K server; uncheck 4K or pick an HD server.', 403);
            }
        }

        const normalizePath = (value) => String(value || '')
            .replace(/\\/g, '/')
            .replace(/\/+$/, '')
            .trim()
            .toLowerCase();

        const body = { serverId: sid };

        if (profileId != null && profileId !== '') {
            const pid = Number(profileId);
            if (!Number.isFinite(pid) || !options.profiles.some((p) => Number(p.id) === pid)) {
                // Profile belonged to the previous server after remap — fall back to active/default.
                const fallback = options.server?.activeProfileId ?? options.profiles[0]?.id;
                if (fallback == null) {
                    throw routingError('Selected quality profile is not allowed for this server.', 403);
                }
                body.profileId = Number(fallback);
            } else {
                body.profileId = pid;
            }
        }

        if (rootFolder != null && rootFolder !== '') {
            const folder = String(rootFolder);
            const folderNorm = normalizePath(folder);
            const matched = options.rootFolders.find((f) => normalizePath(f.path) === folderNorm);
            if (!matched) {
                const fallback = options.server?.activeDirectory || options.rootFolders[0]?.path;
                if (!fallback) {
                    throw routingError('Selected root folder is not allowed for this server.', 403);
                }
                body.rootFolder = String(fallback);
            } else {
                body.rootFolder = String(matched.path);
            }
        }

        if (languageProfileId != null && languageProfileId !== '') {
            const lpid = Number(languageProfileId);
            if (!Number.isFinite(lpid) || !options.languageProfiles.some((lp) => Number(lp.id) === lpid)) {
                const fallback = options.server?.activeLanguageProfileId ?? options.languageProfiles[0]?.id;
                if (fallback != null) body.languageProfileId = Number(fallback);
            } else {
                body.languageProfileId = lpid;
            }
        }

        if (Array.isArray(tags)) {
            const allowedTagIds = new Set(options.tags.map((t) => Number(t.id)));
            const nextTags = tags.map((tag) => Number(tag)).filter((n) => Number.isFinite(n) && allowedTagIds.has(n));
            body.tags = nextTags;
        }

        return body;
    };

    // The full Seerr/Overseerr user list only exists to resolve one portal member to
    // their Seerr user id (id/name/email/plexId rarely change minute-to-minute), but
    // this was being re-fetched — a fresh, uncached ~1000-user JSON request+parse —
    // on essentially every member request action, including per-title "can request?"
    // checks on Discover. Cache it briefly so a burst of calls within the same window
    // shares one fetch; 30s is short enough that a newly-linked Seerr account still
    // resolves almost immediately, long enough to collapse the repeat churn (issue #181).
    const requestUsersCache = createTtlLruCache({ name: 'requestUsers', maxEntries: 4, defaultTtlMs: 30_000 });
    const requestUsersCacheKey = (config = {}) => (
        `${config.requestAppType || ''}:${config.requestAppUrl || ''}:${config.requestAppApiKey || ''}`
    );

    const listRequestUsers = async (config) => {
        const cacheKey = requestUsersCacheKey(config);
        const cached = requestUsersCache.get(cacheKey);
        if (cached) return cached;
        const payload = await fetchSeerrJson(config, '/api/v1/user?take=1000&sort=displayname');
        const results = Array.isArray(payload?.results) ? payload.results : [];
        const users = results.map((u) => ({
            id: u.id,
            displayName: u.displayName || u.username || u.email || `User #${u.id}`,
            email: u.email || null,
            username: u.username || null,
            plexId: u.plexId ?? null,
            avatar: u.avatar || null,
        }));
        requestUsersCache.set(cacheKey, users);
        return users;
    };

    const resolveSeerrRequestUserId = (sessionUser, seerrUsers = []) => {
        if (!sessionUser || !Array.isArray(seerrUsers) || !seerrUsers.length) return null;
        const norm = (value) => String(value || '').trim().toLowerCase();
        const email = norm(sessionUser.email);
        const username = norm(sessionUser.username);
        const plexId = String(sessionUser.plexId || sessionUser.id || '').trim();

        for (const user of seerrUsers) {
            if (email && user.email && norm(user.email) === email) return user.id;
            if (username) {
                if (user.username && norm(user.username) === username) return user.id;
                if (user.displayName && norm(user.displayName) === username) return user.id;
            }
            if (plexId && user.plexId != null && String(user.plexId) === plexId) return user.id;
        }
        return null;
    };

    const getAdvancedRequestDefaults = async (config, { mediaType, tmdbId, userId, is4k }) => {
        try {
            return await fetchSeerrJson(config, '/api/v1/overrideRule/advancedRequest', {
                method: 'POST',
                body: {
                    mediaType: mediaType === 'tv' ? 'tv' : 'movie',
                    tmdbId: Number(tmdbId),
                    userId: Number(userId),
                    is4k: !!is4k,
                },
            });
        } catch {
            return null;
        }
    };

    const updateRequest = async (config, requestId, overrides, existingDetail = null) => {
        const detail = existingDetail || await getRequest(config, requestId);
        const body = buildSeerrUpdateBody(detail, overrides);
        if (detail.type === 'tv' && !Array.isArray(body.seasons)) {
            body.seasons = (detail.seasons || []).map((s) => s.seasonNumber);
        }
        return fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}`, {
            method: 'PUT',
            body,
        });
    };

    const approveRequest = (config, requestId) => (
        fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}/approve`, { method: 'POST' })
    );

    const approveRequestWithOptions = async (config, requestId, overrides = null) => {
        if (overrides && hasRequestOverrides(overrides)) {
            await updateRequest(config, requestId, overrides);
        }
        return approveRequest(config, requestId);
    };

    const declineRequest = (config, requestId, reason = '') => (
        fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}/decline`, {
            method: 'POST',
            body: reason ? { reason } : {},
        })
    );

    const deleteRequest = (config, requestId) => (
        fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}`, { method: 'DELETE' })
    );

    const retryRequest = (config, requestId) => (
        fetchSeerrJson(config, `/api/v1/request/${encodeURIComponent(requestId)}/retry`, { method: 'POST' })
    );

    const resolveMemberSeerrUserId = async (config, sessionUser) => {
        const users = await listRequestUsers(config);
        return resolveSeerrRequestUserId(sessionUser, users);
    };

    const parseSeerrRequestListPayload = (payload) => {
        const results = Array.isArray(payload?.results)
            ? payload.results
            : (Array.isArray(payload?.requests) ? payload.requests : []);
        const pageInfo = payload?.pageInfo || {};
        const total = Number(pageInfo.results ?? pageInfo.total);
        return {
            results,
            total: Number.isFinite(total) && total >= 0 ? total : null,
            pageInfo,
        };
    };

    const fetchMemberRequestPage = async (config, userId, take, skip) => {
        const listParams = new URLSearchParams({
            take: String(take),
            skip: String(skip),
            filter: 'all',
            sort: 'added',
            requestedBy: String(userId),
        });
        // Same list the Seerr UI uses for a user's requests. Fall back to the
        // user-scoped route on older Overseerr builds that lack requestedBy.
        let payload = await fetchSeerrJson(config, `/api/v1/request?${listParams.toString()}`).catch(() => null);
        if (!payload) {
            const userParams = new URLSearchParams({
                take: String(take),
                skip: String(skip),
            });
            payload = await fetchSeerrJson(
                config,
                `/api/v1/user/${encodeURIComponent(userId)}/requests?${userParams.toString()}`,
            );
        }
        const parsed = parseSeerrRequestListPayload(payload);
        const fetched = parsed.results.length;
        const results = parsed.results.filter((item) => {
            const requesterId = item?.requestedBy?.id ?? item?.requestedBy;
            if (requesterId == null || requesterId === '') return true;
            return Number(requesterId) === Number(userId) || String(requesterId) === String(userId);
        });
        return { ...parsed, results, fetched };
    };

    const fetchAllMemberRequests = async (config, userId, { maxItems = 1000 } = {}) => {
        const all = [];
        let skip = 0;
        const pageSize = 50;
        while (all.length < maxItems) {
            const { results, total, fetched } = await fetchMemberRequestPage(config, userId, pageSize, skip);
            if (!fetched) break;
            all.push(...results);
            skip += fetched;
            // A short page means we reached the end. Do not trust pageInfo.results
            // when it equals the page size — some Seerr builds report page length
            // as "results", which previously stopped after the first page.
            if (fetched < pageSize) break;
            if (Number.isFinite(total) && total > pageSize && skip >= total) break;
        }
        return all.slice(0, maxItems);
    };

    const assertMemberOwnsRequest = async (config, sessionUser, requestId) => {
        const userId = await resolveMemberSeerrUserId(config, sessionUser);
        if (!userId) {
            throw new Error('Your portal account is not linked to a Seerr user.');
        }
        const raw = await findSeerrRequestById(config, requestId);
        if (!raw) throw new Error('Request not found');
        const requesterId = Number(raw?.requestedBy?.id);
        if (requesterId !== Number(userId)) {
            throw new Error('You can only manage your own requests.');
        }
        return { userId, raw };
    };

    const listMemberRequests = async (config, sessionUser, { filter = 'all', take = 20, skip = 0 } = {}) => {
        const { publicBaseUrl, baseUrl } = getCredentials(config);
        const linkBaseUrl = publicBaseUrl || baseUrl;
        const userId = await resolveMemberSeerrUserId(config, sessionUser);
        if (!userId) {
            return {
                userMapped: false,
                results: [],
                pageInfo: { pages: 0, results: 0, page: 1 },
                error: 'Your portal account is not linked to a Seerr user.',
            };
        }

        const pageTake = Math.min(200, Math.max(1, Number(take) || 20));
        const pageSkip = Math.max(0, Number(skip) || 0);
        let all = await fetchAllMemberRequests(config, userId);
        const counts = countMemberRequests(all);
        const filtered = filter === 'all'
            ? all
            : all.filter((item) => filterMemberRequestTab(item, filter));
        let page = filtered.slice(pageSkip, pageSkip + pageTake);
        page = await enrichSeerrRequestResults(fetchSeerrJson, config, page);

        return {
            userMapped: true,
            results: page.map((item) => mapSeerrRequestToDto(item, linkBaseUrl)),
            counts,
            pageInfo: {
                pages: Math.max(1, Math.ceil(filtered.length / pageTake) || 1),
                results: filtered.length,
                total: filtered.length,
                page: Math.floor(pageSkip / pageTake) + 1,
                take: pageTake,
                skip: pageSkip,
            },
        };
    };

    const getMemberRequestCounts = async (config, sessionUser) => {
        const userId = await resolveMemberSeerrUserId(config, sessionUser);
        if (!userId) {
            return {
                userMapped: false,
                pending: 0,
                approved: 0,
                available: 0,
                declined: 0,
                failed: 0,
                total: 0,
            };
        }
        let all = await fetchAllMemberRequests(config, userId);
        return { userMapped: true, ...countMemberRequests(all) };
    };

    const cancelMemberRequest = async (config, sessionUser, requestId) => {
        const { raw } = await assertMemberOwnsRequest(config, sessionUser, requestId);
        const status = Number(raw?.status);
        if (status !== 1) {
            throw new Error('Only pending requests can be cancelled.');
        }
        return deleteRequest(config, requestId);
    };

    const retryMemberRequest = async (config, sessionUser, requestId) => {
        const { raw } = await assertMemberOwnsRequest(config, sessionUser, requestId);
        if (!isFailedSeerrRequest(raw)) {
            throw new Error('Only failed requests can be retried.');
        }
        return retryRequest(config, requestId);
    };

    const getMemberWatchlist = async (config, sessionUser = null) => {
        // If the user is the portal admin, they own the API key; show the master watchlist.
        if (sessionUser?.isAdmin) {
            try {
                const payload = await fetchSeerrJson(config, '/api/v1/discover/watchlist');
                const results = Array.isArray(payload?.results) ? payload.results : [];
                return { results };
            } catch (err) {
                // Fallthrough on error
            }
        }

        // Prefer the mapped Seerr user's watchlist — never fall back to the shared
        // API-key (admin) discover watchlist for members.
        const userId = sessionUser
            ? await resolveMemberSeerrUserId(config, sessionUser).catch(() => null)
            : null;
        if (userId) {
            try {
                const payload = await fetchSeerrJson(
                    config,
                    `/api/v1/user/${encodeURIComponent(userId)}/watchlist?take=50`,
                );
                const results = Array.isArray(payload?.results)
                    ? payload.results
                    : (Array.isArray(payload) ? payload : []);
                return { results };
            } catch (err) {
                // Older Seerr builds / permission gaps — return empty rather than 500.
                return { results: [] };
            }
        }
        return { results: [] };
    };

    const memberSeerrSessionError = (message) => {
        const err = new Error(message);
        err.status = 403;
        err.code = 'SEERR_MEMBER_SESSION_REQUIRED';
        return err;
    };

    const loginSeerrWithPlexToken = async (config, plexToken) => {
        const token = String(plexToken || '').trim();
        if (!token) return null;
        const { baseUrl } = getCredentials(config);
        let response;
        try {
            response = await fetchWithTimeout(`${baseUrl}/api/v1/auth/plex`, {
                method: 'POST',
                redirect: 'manual',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ authToken: token }),
            }, 15000);
        } catch {
            return null;
        }
        const status = Number(response?.status) || 0;
        // 2xx login or 3xx (reverse-proxy) — capture Set-Cookie before fetch follows a redirect.
        if (!response || status < 200 || status >= 400) return null;
        const cookie = cookieHeaderFromSetCookie(response.headers);
        if (!cookie) return null;
        let user = null;
        if (status < 300 && typeof response.json === 'function') {
            try {
                user = await response.json();
            } catch {
                user = null;
            }
        }
        return { cookie, user };
    };

    const submitMemberRequest = async (config, sessionUser, {
        mediaType,
        mediaId,
        is4k = false,
        seasons = null,
        serverId = null,
        profileId = null,
        rootFolder = null,
        languageProfileId = null,
        tags = null,
    } = {}) => {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(mediaId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) throw new Error('Invalid mediaId');

        const body = { mediaType: type, mediaId: tmdbId };
        if (is4k) body.is4k = true;
        if (type === 'tv') {
            if (seasons === 'all' || seasons == null) body.seasons = 'all';
            else if (Array.isArray(seasons) && seasons.length) body.seasons = seasons;
            else body.seasons = 'all';
        }
        if (serverId != null) body.serverId = serverId;
        if (profileId != null) body.profileId = profileId;
        if (rootFolder) body.rootFolder = rootFolder;
        if (languageProfileId != null) body.languageProfileId = languageProfileId;
        if (Array.isArray(tags) && config.portalAllowRequestTags !== false) body.tags = tags;

        const plexToken = typeof resolveMemberPlexToken === 'function'
            ? await resolveMemberPlexToken(sessionUser).catch(() => null)
            : null;
        if (!plexToken) {
            throw memberSeerrSessionError(
                'Sign in with Plex to submit requests. Seerr needs your Plex session so the request stays pending for approval.',
            );
        }

        const session = await loginSeerrWithPlexToken(config, plexToken);
        if (!session?.cookie) {
            throw memberSeerrSessionError(
                'Could not open a Seerr session with your Plex login. Sign in with Plex again, or ask your admin to import your Plex account into Seerr.',
            );
        }

        // Cookie auth uses the member's Seerr permissions. Never send the admin API key —
        // Seerr auto-approves anything created by the key owner, even when userId is set.
        const created = await fetchSeerrJson(config, '/api/v1/request', {
            method: 'POST',
            body,
            cookie: session.cookie,
        });
        if (created && requestNeedsMediaEnrichment(created)) {
            const enriched = await enrichSeerrRequestResults(fetchSeerrJson, config, [created]);
            return enriched[0] || created;
        }
        return created;
    };

    const requestMemberWatchlist = async (config, sessionUser, { all = false, items = [], is4k = false } = {}) => {
        const userId = await resolveMemberSeerrUserId(config, sessionUser);
        if (!userId) {
            throw new Error('Your portal account is not linked to a Seerr user.');
        }

        let targets = [];
        if (all) {
            const watchlist = await getMemberWatchlist(config, sessionUser);
            targets = (watchlist.results || [])
                .map((item) => normalizeWatchlistTarget(item))
                .filter(Boolean);
        } else {
            targets = (Array.isArray(items) ? items : [])
                .map((item) => normalizeWatchlistTarget(item))
                .filter(Boolean);
        }

        const summary = {
            submitted: 0,
            skipped: 0,
            failed: 0,
            results: [],
        };

        for (const target of targets) {
            try {
                const options = await getMemberRequestOptions(config, sessionUser, target);
                if (!options.canRequest) {
                    summary.skipped += 1;
                    summary.results.push({
                        ...target,
                        status: 'skipped',
                        reason: options.blockReason || 'Not requestable',
                    });
                    continue;
                }

                await submitMemberRequest(config, sessionUser, {
                    mediaType: target.mediaType,
                    mediaId: target.mediaId,
                    is4k,
                    seasons: target.mediaType === 'tv' ? 'all' : null,
                });

                summary.submitted += 1;
                summary.results.push({ ...target, status: 'submitted' });
            } catch (err) {
                const message = err?.message || 'Request failed';
                summary.failed += 1;
                summary.results.push({ ...target, status: 'failed', error: message });
                if (/quota|limit|exceeded/i.test(message)) break;
            }
        }

        return summary;
    };

    const getMemberRequestOptions = async (config, sessionUser, { mediaType, mediaId }) => {
        const type = mediaType === 'tv' ? 'tv' : 'movie';
        const tmdbId = Number(mediaId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
            throw new Error('Invalid mediaId');
        }

        const serviceSegment = type === 'tv' ? 'sonarr' : 'radarr';
        const [details, users, servers] = await Promise.all([
            fetchSeerrJson(config, `/api/v1/${type}/${tmdbId}`),
            listRequestUsers(config).catch(() => []),
            fetchSeerrJson(config, `/api/v1/service/${serviceSegment}`).catch(() => []),
        ]);

        const userId = resolveSeerrRequestUserId(sessionUser, users);
        let seerrUser = null;
        let quotaRaw = null;

        if (userId) {
            [seerrUser, quotaRaw] = await Promise.all([
                fetchSeerrJson(config, `/api/v1/user/${encodeURIComponent(userId)}`).catch(() => null),
                fetchSeerrJson(config, `/api/v1/user/${encodeURIComponent(userId)}/quota`).catch(() => null),
            ]);
        }

        const permissions = Number(seerrUser?.permissions) || 0;
        const mediaInfo = details?.mediaInfo || {};
        const mediaStatus = Number(mediaInfo?.status) || null;
        const isBlacklisted = mediaStatus === 6;

        let sonarrLibraryStatus = null;
        if (type === 'tv') {
            const year = Number(String(details?.firstAirDate || details?.first_air_date || '').slice(0, 4));
            try {
                const library = createLibraryAvailability(config);
                const tvStatus = await library.getTvListStatus(tmdbId, {
                    title: details?.name || details?.title || '',
                    year: Number.isFinite(year) && year > 1900 ? year : null,
                    networkLookups: false,
                });
                sonarrLibraryStatus = tvStatus?.sonarrLibraryStatus || null;
            } catch {
                sonarrLibraryStatus = null;
            }
        }

        const serverList = normalizeServerListIs4k((Array.isArray(servers) ? servers : []).map((s) => ({
            ...s,
            is4k: inferServerIs4k(s),
        })));
        const has4kServer = serverList.some((s) => !!s.is4k);
        const hasHdServer = serverList.some((s) => !s.is4k);

        const canRequestBase = canSeerrRequestMedia(permissions, type) && !isBlacklisted;
        const canRequest4k = canSeerrRequest4k(permissions, type);
        const portalDefaults = getPortalRequestDefaults(config);
        // StreamPilot toggle wins: when advanced is off, skip destination / profile / library / tags
        // even if Seerr would otherwise allow REQUEST_ADVANCED.
        const canRequestAdvanced = !!portalDefaults.allowAdvancedRequests
            && (hasHdServer || has4kServer)
            && !!userId;
        const canCreateIssues = canSeerrCreateIssues(permissions);
        const permissionFlags = mapSeerrPermissionFlags(permissions);
        permissionFlags.requestAdvanced = canRequestAdvanced;
        permissionFlags.requestTags = !!portalDefaults.allowRequestTags && canRequestAdvanced;

        const quota = mapSeerrQuotaResponse(quotaRaw, type);
        const seasons = type === 'tv'
            ? buildMemberSeasonOptions({ ...details, sonarrLibraryStatus }, mediaInfo)
            : [];

        let blockReason = null;
        if (isBlacklisted) blockReason = 'This title is blacklisted.';
        else if (!userId) blockReason = 'Your portal account is not linked to a Seerr user. Contact your admin.';
        else if (!canRequestBase) blockReason = 'You do not have permission to request media.';
        else if (type === 'movie' && !hasHdServer && !has4kServer) blockReason = 'No Radarr server is configured in Seerr.';
        else if (type === 'tv' && !hasHdServer && !has4kServer) blockReason = 'No Sonarr server is configured in Seerr.';

        let canRequest = canRequestBase && !!userId;
        const mediaStatus4k = Number(mediaInfo?.status4k);
        const movieRequestability = type === 'movie'
            ? evaluateSeerrMovieRequestability({
                mediaStatus,
                mediaStatus4k,
                hasHdServer,
                has4kServer,
                canRequest4k: canRequest4k && has4kServer,
            })
            : null;
        let availabilityNote = null;
        let libraryQualities = null;
        let requestedQualities = null;
        if (type === 'movie' && canRequest && movieRequestability) {
            canRequest = movieRequestability.canRequest;
            blockReason = blockReason || movieRequestability.blockReason;
            availabilityNote = movieRequestability.availabilityNote;
            libraryQualities = movieRequestability.libraryQualities;
            requestedQualities = movieRequestability.requestedQualities;
            if (
                !canRequest
                && Number(mediaStatus) === 3
                && isMediaActivelyProcessing(mediaInfo, mediaStatus)
            ) {
                blockReason = 'This request is currently downloading.';
            }
        } else if (canRequest) {
            const requestableCount = seasons.filter((s) => s.requestable).length;
            // Upcoming shows often have zero TMDB seasons yet — that is not "already requested".
            if (seasons.length > 0 && requestableCount === 0) {
                canRequest = false;
                blockReason = blockReason || 'All seasons are already requested or available.';
            }
        }

        const standardQuota = quota.standard;
        const fourKQuota = quota.fourK;
        const standardQuotaBlocked = !!(
            standardQuota?.limit > 0 && standardQuota.remaining === 0
        );
        const fourKQuotaBlocked = !!(
            fourKQuota?.limit > 0 && fourKQuota.remaining === 0
        );
        // Keep title requestable when only HD quota is exhausted so 4K-only submits remain possible.
        if (canRequest && standardQuotaBlocked && (!canRequest4k || !has4kServer || fourKQuotaBlocked)) {
            canRequest = false;
            blockReason = `You have used all ${standardQuota.limit} requests for this period.`;
        }

        const seerrRows = (Array.isArray(mediaInfo.requests) ? mediaInfo.requests : []).map((row) => ({
            userId: row?.requestedBy?.id ?? row?.requestedBy,
            status: Number(row?.status) || 1,
            displayName: row?.requestedBy?.displayName || row?.requestedBy?.username || null,
        }));
        const notifyRecords = seerrRows.length
            ? seerrRows
            : ((mediaStatus === 2 || mediaStatus === 3 || mediaStatus4k === 2 || mediaStatus4k === 3)
                ? [{ userId: '__other__', status: 1 }]
                : []);
        const portalViewerId = String(sessionUser?.id || sessionUser?.plexId || '').trim();
        const watching = portalViewerId
            ? await isWatchingTitle(watcherTitleKey({ mediaType: type, tmdbId }), portalViewerId)
            : false;
        const notifyMediaStatus = (
            type === 'movie'
            && Number(mediaStatus) === 5
            && Number(mediaStatus4k) !== 5
        ) ? (Number.isFinite(mediaStatus4k) ? mediaStatus4k : 1) : mediaStatus;
        const notifyFlags = notifyEligibility({
            viewerId: String(userId || ''),
            records: notifyRecords,
            mediaStatus: notifyMediaStatus,
            isBlacklisted,
            isWatching: watching,
        });
        const requesterSummary = summarizeOtherRequesters(notifyRecords, String(userId || ''));

        return {
            mediaType: type,
            tmdbId,
            title: details?.title || details?.name || '',
            overview: details?.overview || '',
            mediaStatus: Number.isFinite(mediaStatus) ? mediaStatus : null,
            isBlacklisted,
            isAnime: detectAnimeMedia(details, { mediaType: type }),
            canRequest,
            canRequest4k: canRequest4k && has4kServer,
            canRequestAdvanced,
            canRequestTags: !!portalDefaults.allowRequestTags && canRequestAdvanced,
            canCreateIssues,
            has4kServer,
            hasHdServer,
            standardQuotaBlocked,
            fourKQuotaBlocked,
            seerrUserId: userId || null,
            servers: serverList.map((s) => ({
                id: s.id,
                name: s.name,
                is4k: !!s.is4k,
                isDefault: !!s.isDefault,
            })),
            permissions: {
                ...permissionFlags,
                request: canRequestBase,
                request4k: canRequest4k,
                requestAdvanced: canRequestAdvanced,
                requestTags: !!portalDefaults.allowRequestTags && canRequestAdvanced,
                createIssues: canCreateIssues,
            },
            quota,
            seasons,
            userMapped: !!userId,
            blockReason,
            posterPath: details?.posterPath || null,
            engine: 'seerr',
            mediaInfo,
            availabilityNote,
            libraryQualities,
            requestedQualities,
            canNotify: notifyFlags.canNotify,
            isWatching: notifyFlags.isWatching,
            requestedByName: requesterSummary.requestedByName,
            requestedByCount: requesterSummary.requestedByCount,
        };
    };

    const createMemberRequestTag = async (config, sessionUser, {
        mediaType,
        label,
        serverName = '',
    }) => {
        const cleanLabel = String(label || '').trim();
        if (!cleanLabel) {
            const err = new Error('Tag label is required');
            err.status = 400;
            throw err;
        }
        const portalDefaults = getPortalRequestDefaults(config);
        if (!portalDefaults.allowAdvancedRequests || !portalDefaults.allowRequestTags) {
            const err = new Error(
                portalDefaults.allowAdvancedRequests
                    ? 'Request tags are disabled.'
                    : 'Advanced request options are disabled.',
            );
            err.status = 403;
            throw err;
        }

        const users = await listRequestUsers(config).catch(() => []);
        const userId = resolveSeerrRequestUserId(sessionUser, users);
        if (!userId) {
            const err = new Error('Your portal account is not linked to a Seerr user.');
            err.status = 403;
            throw err;
        }

        const seerrUser = await fetchSeerrJson(config, `/api/v1/user/${encodeURIComponent(userId)}`).catch(() => null);
        const permissions = Number(seerrUser?.permissions) || 0;
        // Tag creation goes through portal Arr credentials; any linked requester may create tags.
        const canRequestMedia = canSeerrRequestMedia(permissions, mediaType === 'tv' ? 'tv' : 'movie')
            || hasSeerrManageAccess(permissions);
        if (!canRequestMedia) {
            const err = new Error('You do not have permission to request media.');
            err.status = 403;
            throw err;
        }

        const arrType = mediaType === 'tv' ? 'sonarr' : 'radarr';
        const readyInstances = getArrInstances(config, { type: arrType, enabledOnly: true })
            .filter((entry) => isArrInstanceReady(entry));
        if (!readyInstances.length) {
            const err = new Error(
                `No ${arrType === 'sonarr' ? 'Sonarr' : 'Radarr'} instance is configured in the portal. `
                + 'Create the tag there first, or add Arr credentials in Settings.',
            );
            err.status = 400;
            throw err;
        }

        const nameKey = String(serverName || '').trim().toLowerCase();
        const instance = (nameKey
            ? readyInstances.find((entry) => String(entry.name || '').trim().toLowerCase() === nameKey)
            : null)
            || getDefaultArrInstance(config, arrType)
            || readyInstances[0];

        const fetchOpts = {
            resolveUrl: resolveIntegrationUrlForFetch,
            fetchImpl: fetchWithTimeout,
        };

        const created = await fetchArrInstance(instance, '/api/v3/tag', {
            ...fetchOpts,
            method: 'POST',
            body: { label: cleanLabel },
        });
        if (created?.ok && created.data?.id != null) {
            return {
                id: Number(created.data.id),
                label: String(created.data.label || cleanLabel),
            };
        }

        const listed = await fetchArrInstance(instance, '/api/v3/tag', fetchOpts);
        const tags = Array.isArray(listed?.data) ? listed.data : [];
        const existing = tags.find((tag) => (
            String(tag?.label || '').trim().toLowerCase() === cleanLabel.toLowerCase()
        ));
        if (existing?.id != null) {
            return {
                id: Number(existing.id),
                label: String(existing.label || cleanLabel),
            };
        }

        const err = new Error(
            `Tag must already exist in ${arrType === 'sonarr' ? 'Sonarr' : 'Radarr'}, or Arr must allow creating tags.`,
        );
        err.status = 400;
        throw err;
    };

    const getMemberDiscoveryProfile = async (config, sessionUser) => {
        const { publicBaseUrl, baseUrl } = getCredentials(config);
        const seerrUrl = publicBaseUrl || baseUrl || '';
        const users = await listRequestUsers(config).catch(() => []);
        const userId = resolveSeerrRequestUserId(sessionUser, users);

        const portalDefaults = getPortalRequestDefaults(config);
        if (!userId) {
            return {
                engine: 'seerr',
                userMapped: false,
                seerrUserId: null,
                displayName: null,
                email: null,
                seerrUrl,
                seerrSettingsUrl: seerrUrl ? `${seerrUrl.replace(/\/$/, '')}/settings/users` : '',
                permissions: {
                    ...mapSeerrPermissionFlags(0),
                    requestAdvanced: false,
                    requestTags: false,
                },
                quota: mapFullSeerrQuota(null),
                autoApprove: {
                    requests: false,
                    movies: false,
                    tv: false,
                    requests4k: false,
                    movies4k: false,
                    tv4k: false,
                },
            };
        }

        const [seerrUser, quotaRaw] = await Promise.all([
            fetchSeerrJson(config, `/api/v1/user/${encodeURIComponent(userId)}`).catch(() => null),
            fetchSeerrJson(config, `/api/v1/user/${encodeURIComponent(userId)}/quota`).catch(() => null),
        ]);

        const permissions = Number(seerrUser?.permissions) || 0;
        const flags = mapSeerrPermissionFlags(permissions);

        return {
            engine: 'seerr',
            userMapped: true,
            seerrUserId: userId,
            displayName: seerrUser?.displayName || seerrUser?.username || null,
            email: seerrUser?.email || null,
            seerrUrl,
            seerrSettingsUrl: seerrUrl ? `${seerrUrl.replace(/\/$/, '')}/settings/users` : '',
            seerrUserUrl: seerrUrl ? `${seerrUrl.replace(/\/$/, '')}/users/${userId}` : '',
            permissions: {
                ...flags,
                requestAdvanced: !!portalDefaults.allowAdvancedRequests && flags.requestAdvanced,
                requestTags: !!portalDefaults.allowRequestTags
                    && !!portalDefaults.allowAdvancedRequests
                    && flags.requestAdvanced,
            },
            quota: mapFullSeerrQuota(quotaRaw),
            autoApprove: {
                requests: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE),
                movies: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE, SeerrPermission.AUTO_APPROVE_MOVIE),
                tv: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE, SeerrPermission.AUTO_APPROVE_TV),
                requests4k: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE_4K),
                movies4k: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE_4K, SeerrPermission.AUTO_APPROVE_4K_MOVIE),
                tv4k: hasSeerrPermission(permissions, SeerrPermission.AUTO_APPROVE_4K, SeerrPermission.AUTO_APPROVE_4K_TV),
            },
        };
    };

    const issueService = createSeerrIssueService({
        fetchSeerrJson,
        resolveMemberSeerrUserId,
        getCredentials,
    });

    const blocklistService = createSeerrBlocklistService({
        fetchSeerrJson,
        getCredentials,
        listRequestUsers,
        resolveSeerrRequestUserId,
    });

    return {
        listRequests,
        getRequestCounts,
        getRequest,
        listServiceServers,
        getServiceOptions,
        validateMemberRequestRouting,
        listRequestUsers,
        resolveSeerrRequestUserId,
        getAdvancedRequestDefaults,
        updateRequest,
        approveRequest,
        approveRequestWithOptions,
        declineRequest,
        deleteRequest,
        retryRequest,
        getMemberRequestOptions,
        createMemberRequestTag,
        getMemberDiscoveryProfile,
        listMemberRequests,
        getMemberRequestCounts,
        cancelMemberRequest,
        retryMemberRequest,
        getMemberWatchlist,
        requestMemberWatchlist,
        submitMemberRequest,
        rawFetch: fetchSeerrJson,
        rawFetchOptional: fetchSeerrOptional,
        isRequestAppConfigured,
        isSeerrFamilyRequestApp,
        ...issueService,
        ...blocklistService,
    };
};
