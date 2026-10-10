import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import {
    clampPlayOffsetMs,
    isAllowedPlexProxyUrl,
    isHlsPlaylist,
    isPlaySessionId,
    isPlayerQualityId,
    actorQueryValues,
    expandStudioQueryValues,
    buildPlayerHlsSrc,
    buildPlayerFileSrc,
    buildPlayerHlsFallbackSrc,
    withPlaybackAccessToken,
    canHttpDirectPlay,
    isAudioOnlyPlexMeta,
    isHevcVideo,
    normalizePlaybackCaps,
    playbackCapsFromRequest,
    pickPlayerPartId,
    pickMediaIndex,
    pickDirectPlayAudioStreamId,
    subtitleCodecNeedsBurn,
    withSelectedMedia,
    mapContinueWatchingItem,
    isLibraryContinueWatchingHub,
    dedupeLibraryContinueWatchingHubs,
    withMemberContinueWatching,
    assembleLibraryHomeHubs,
    mapPlayerExtras,
    listPlayerExtraMetas,
    mapPlayerFilterOptions,
    mapPlayerHubs,
    mapPlayerHomeHubs,
    mergeSameTitleHomeHubs,
    markHeroCollectionHubs,
    plexHeroUuidFromMeta,
    heroAssetsFromProvider,
    mapPlayerItem,
    mapPlayerItemDetails,
    mapPlayerPersonSearchHit,
    isPlexPersonSearchHit,
    isPlexPeopleSearchHub,
    applyShowMetaToPlayerChild,
    isPlayablePlexMeta,
    normalizePlayerItemType,
    mapPlayerMarkers,
    mapPlayerPlaybackMode,
    mapPlayerPlaybackOptions,
    mapPlayerPlaybackSource,
    normalizePlayerSettings,
    mapPlayerProfile,
    mapPlayerPlaylist,
    mapPlayerSection,
    mapPlayerVersions,
    mapRecentlyAddedItem,
    nextEpisodeInList,
    previousEpisodeInList,
    pickPersonFromMetadata,
    plexPlaylistUri,
    PLAYER_LIBRARY_SORT_IDS,
    resolvePlayOffsetMs,
    rewritePlaylistUrls,
    rewritePlexUrlToOrigin,
    transcodeSettingsForQuality,
    TIMELINE_STATES,
    buildPlexTimelineParams,
    ORIGINAL_PLAYER_QUALITY_ID,
    collectionChildItems,
    collectionChildPaths,
    withPlexContainerParams,
    withPlexSortParam,
    isRandomOrderSource,
    shuffleRows,
    plexContainerItems,
    mapLibraryHubItem,
    safePlexLibraryPath,
    pickPlayerThemePath,
    isPlayerThemePath,
} from './mapItem.js';
import { isPlexOwnerLocalAccountId } from '../plex/localAccountId.js';
import {
    DEFAULT_ON_DECK_WINDOW_WEEKS,
    fetchMemberOnDeckFromHistory,
    fetchPlexOnDeckWindowWeeks,
    filterWithinOnDeckWindow,
} from '../plex/memberOnDeckFromHistory.js';
import { buildMediaPlayerHomeHero, clearMediaPlayerHomeHeroCache, normalizeMediaPlayerHomeHeroMode, resolveEffectiveHeroMode } from './homeHero.js';
import { getOrFetchMediaImage, mediaImageCacheKey } from '../media-image-cache.js';
import { resolvePlayerPersonProfile } from './personProfile.js';

const HLS_CLIENT_PROFILE = [
    'add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.width&value=1920)',
    'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.height&value=1080)',
].join('+');

const plexStreamLocation = (uri) => {
    try {
        const host = new URL(uri).hostname.toLowerCase();
        if (
            host === 'localhost'
            || host.endsWith('.local')
            || host.endsWith('.plex.direct')
            || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
        ) return 'lan';
    } catch {
        /* ignore */
    }
    return 'wan';
};

const STREAM_IDENTITY = 'player';

const PLAYER_POSTER_QUALITY = 60;
const PLAYER_BACKDROP_WIDTH = 1920;
const PLAYER_BACKDROP_HEIGHT = 1080;
const PLAYER_BACKDROP_QUALITY = 100;
const PLAYER_BACKDROP_PREVIEW_WIDTH = 640;
const PLAYER_BACKDROP_PREVIEW_HEIGHT = 360;
const PLAYER_BACKDROP_PREVIEW_QUALITY = 40;
const FIRST_SCREEN_POSTERS = 16;

const isWarmableThumb = (thumb) => {
    const path = String(thumb || '').trim();
    if (!path.startsWith('/') || path.startsWith('//')) return false;
    if (path.includes('..') || path.includes('\\') || path.includes('://')) return false;
    return true;
};

const posterWarmJob = (item) => {
    if (!isWarmableThumb(item?.thumb)) return null;
    const type = String(item?.type || '');
    if (type === 'episode') return { path: item.thumb, width: 426, height: 240, quality: PLAYER_POSTER_QUALITY };
    if (type === 'artist' || type === 'album') return { path: item.thumb, width: 300, height: 300, quality: PLAYER_POSTER_QUALITY };
    return { path: item.thumb, width: 300, height: 450, quality: PLAYER_POSTER_QUALITY };
};

/** First visible posters, filling from later rows when the first row is short. */
const firstScreenItems = (groups, limit = FIRST_SCREEN_POSTERS) => {
    const items = [];
    for (const group of groups) {
        const rows = Array.isArray(group) ? group : (group?.items || []);
        for (const item of rows) {
            if (!item?.thumb) continue;
            items.push(item);
            if (items.length >= limit) return items;
        }
    }
    return items;
};

const plexFetch = async (fetchImpl, url, headers, { timeoutMs } = {}) => {
    const extra = {};
    if (Number(timeoutMs) > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        extra.signal = AbortSignal.timeout(Math.floor(Number(timeoutMs)));
    }
    return fetchImpl(url, { headers, ...extra });
};

const plexJson = async (fetchImpl, url, headers, { timeoutMs } = {}) => {
    const res = await plexFetch(fetchImpl, url, headers, { timeoutMs });
    if (!res.ok) throw new Error(`Plex request failed (${res.status})`);
    try {
        return await res.json();
    } catch {
        throw new Error('Plex returned a non-JSON response.');
    }
};

const isPlexNotFound = (error) => /\(404\)/.test(String(error?.message || ''));

const plexJsonOrNull = async (fetchImpl, url, headers) => {
    try {
        return await plexJson(fetchImpl, url, headers);
    } catch (error) {
        if (isPlexNotFound(error)) return null;
        throw error;
    }
};

const isPlexAuthError = (error) => /\(401\)|\(403\)/.test(String(error?.message || ''));

const plexJsonWithAuth = async (fetchImpl, attempts, { timeoutMs } = {}) => {
    const list = (Array.isArray(attempts) ? attempts : []).filter((row) => row?.token && row?.url);
    const seen = new Set();
    let lastError;
    for (const attempt of list) {
        const key = String(attempt.token);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
            return await plexJson(fetchImpl, attempt.url, attempt.headers, { timeoutMs });
        } catch (error) {
            lastError = error;
            if (!isPlexAuthError(error)) throw error;
        }
    }
    throw lastError || new Error('Plex request failed.');
};

const sendJsonError = (res, status, error, fallback) => {
    if (res.headersSent) return;
    const message = String((error && error.message) || fallback || 'Request failed.');
    res.status(status).json({ error: message });
};

const heroCoverMemory = new Map();

const attachPlexHeroCoverArt = async (hubs, { fetchImpl, uri, token, headers, hubOpts }) => {
    const list = Array.isArray(hubs) ? hubs : [];
    const keys = [...new Set(list
        .filter((hub) => hub?.heroRow)
        .flatMap((hub) => hub.items || [])
        .map((item) => String(item?.ratingKey || ''))
        .filter(Boolean))];
    if (!keys.length || !token) return list;
    const guidByKey = new Map();
    for (let index = 0; index < keys.length; index += 40) {
        const ids = keys.slice(index, index + 40).map((id) => encodeURIComponent(id)).join(',');
        const data = await plexJson(
            fetchImpl,
            `${uri}/library/metadata/${ids}?includeGuids=1&X-Plex-Token=${encodeURIComponent(token)}`,
            headers,
            hubOpts,
        ).catch(() => null);
        metadataList(data).forEach((meta) => {
            const uuid = plexHeroUuidFromMeta(meta);
            if (uuid) guidByKey.set(String(meta.ratingKey || ''), uuid);
        });
    }
    const covers = new Map();
    const uuids = [...new Set(guidByKey.values())];
    for (let index = 0; index < uuids.length; index += 6) {
        const part = uuids.slice(index, index + 6);
        await Promise.all(part.map(async (uuid) => {
            const stored = heroCoverMemory.get(uuid);
            if (stored?.still) {
                covers.set(uuid, stored);
                return;
            }
            const data = await plexJson(
                fetchImpl,
                `https://metadata.provider.plex.tv/library/metadata/${encodeURIComponent(uuid)}?X-Plex-Token=${encodeURIComponent(token)}`,
                headers,
                { timeoutMs: 8000 },
            ).catch(() => null);
            const assets = heroAssetsFromProvider(data);
            if (!assets?.still) return;
            heroCoverMemory.set(uuid, assets);
            covers.set(uuid, assets);
        }));
    }
    if (!covers.size) return list;
    return list.map((hub) => {
        if (!hub?.heroRow) return hub;
        return {
            ...hub,
            items: (hub.items || []).map((item) => {
                const assets = covers.get(guidByKey.get(String(item?.ratingKey || '')) || '');
                return assets?.still ? { ...item, heroArt: assets.still } : item;
            }),
        };
    });
};

const metadataList = (payload) => {
    const list = payload?.MediaContainer?.Metadata;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return [list];
    return [];
};

const dedupeItems = (list, limit = 24) => {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).filter((row) => {
        const key = row?.dedupeKey || row?.ratingKey || row?.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
};

const directoryList = (payload) => payload?.MediaContainer?.Directory || [];

export const createMediaPlayerRouter = ({
    Router,
    requireAuth,
    requireMember,
    requireAdmin = null,
    loadPortalConfig,
    savePortalConfig = null,
    getPlexConnectionUri,
    plexClientHeaders,
    fetchImpl = fetch,
    clientId = 'portal-media-player',
    appVersion = '1',
    resolveMemberPlexToken = async () => null,
    resolveMemberAccountId = async () => null,
    getMediaPlayerSettings = async () => ({ ...normalizePlayerSettings(), saved: false }),
    saveMediaPlayerSettings = async (_req, settings) => normalizePlayerSettings(settings),
    getMediaPlayerProfile = async (req) => mapPlayerProfile(req?.user || {}),
}) => {
    const router = Router();

    const kickPlayerImageJobs = (uri, token, headers, jobs, { priority = 'live' } = {}) => {
        const seen = new Set();
        for (const job of jobs || []) {
            if (!job?.path || seen.has(`${job.path}|${job.width}|${job.quality}`)) continue;
            seen.add(`${job.path}|${job.width}|${job.quality}`);
            const key = mediaImageCacheKey({
                source: 'plex',
                id: `${job.path}|q${job.quality}`,
                width: job.width,
                height: job.height,
            });
            const url = `${uri}/photo/:/transcode?url=${encodeURIComponent(job.path)}&width=${job.width}&height=${job.height}&minSize=1&upscale=0&quality=${job.quality}&X-Plex-Token=${encodeURIComponent(token)}`;
            void getOrFetchMediaImage(key, async () => {
                const response = await plexFetch(fetchImpl, url, headers, { timeoutMs: 15000 });
                if (!response?.ok) {
                    try { await response?.body?.cancel?.(); } catch { /* ignore */ }
                    return null;
                }
                const body = Buffer.from(await response.arrayBuffer());
                if (!body.length) return null;
                return {
                    body,
                    contentType: response.headers.get('content-type') || 'image/jpeg',
                };
            }, { priority }).catch(() => null);
        }
    };

    const kickPlayerPosters = (uri, token, headers, items) => {
        kickPlayerImageJobs(uri, token, headers, (items || []).map((item) => posterWarmJob(item)).filter(Boolean), {
            priority: 'live',
        });
    };

    const kickPlayerBackdrops = (uri, token, headers, items, limit = 4) => {
        const jobs = [];
        const seen = new Set();
        for (const item of items || []) {
            const path = item?.art;
            if (!isWarmableThumb(path) || seen.has(path)) continue;
            seen.add(path);
            jobs.push({
                path,
                width: PLAYER_BACKDROP_PREVIEW_WIDTH,
                height: PLAYER_BACKDROP_PREVIEW_HEIGHT,
                quality: PLAYER_BACKDROP_PREVIEW_QUALITY,
            });
            jobs.push({
                path,
                width: PLAYER_BACKDROP_WIDTH,
                height: PLAYER_BACKDROP_HEIGHT,
                quality: PLAYER_BACKDROP_QUALITY,
            });
            if (seen.size >= limit) break;
        }
        kickPlayerImageJobs(uri, token, headers, jobs, { priority: 'low' });
    };

    const homeCache = new Map();
    const libraryHomeCache = new Map();
    const libraryFiltersCache = new Map();
    const HOME_CACHE_TTL_MS = 3 * 60_000;
    const HOME_STALE_TTL_MS = 15 * 60_000;
    const LIBRARY_HOME_CACHE_TTL_MS = 3 * 60_000;
    const LIBRARY_HOME_STALE_TTL_MS = 15 * 60_000;
    const LIBRARY_FILTERS_CACHE_TTL_MS = 5 * 60_000;
    const ON_DECK_WINDOW_CACHE_TTL_MS = 5 * 60_000;
    const HOME_HUB_COUNT = 16;
    const HOME_PLEX_TIMEOUT_MS = 8000;
    const HOME_HISTORY_TIMEOUT_MS = 1200;
    const LIBRARY_PLEX_TIMEOUT_MS = 8000;
    const adminOnly = typeof requireAdmin === 'function' ? requireAdmin : requireMember;
    let onDeckWindowCache = { at: 0, weeks: DEFAULT_ON_DECK_WINDOW_WEEKS };
    const DIRECT_PLAY_PART_TTL_MS = 2 * 60_000;
    const HLS_PLAYLIST_TTL_MS = 25_000;
    const directPlayPartCache = new Map();
    const hlsPlaylistCache = new Map();

    const identityKey = (req) => {
        const raw = String(req?.user?.plexAccountId || req?.user?.plexId || req?.user?.id || 'anon');
        return raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24) || 'anon';
    };

    const homeCacheKey = (req) => {
        const id = String(req?.user?.id || '').trim();
        const plex = String(req?.user?.plexAccountId || req?.user?.plexId || '').trim();
        const name = String(req?.user?.username || req?.user?.title || '').trim();
        const raw = [id, plex, name].filter(Boolean).join('|') || 'anon';
        return raw.slice(0, 80);
    };

    const deviceNameFor = (req) => {
        const name = String(req?.user?.username || req?.user?.title || '').trim();
        return name ? `Portal (${name})` : 'Portal Media Player';
    };

    const playerHeaders = (token, identity = 'player', deviceName = 'Portal Media Player') => {
        const base = plexClientHeaders(token);
        const identifier = String(base['X-Plex-Client-Identifier'] || clientId || 'portal');
        return {
            ...base,
            'X-Plex-Provides': 'player,controller',
            'X-Plex-Device-Name': deviceName || 'Portal Media Player',
            'X-Plex-Client-Identifier': `${identifier}-mp-${identity}`,
            'X-Plex-Product': 'Portal Media Player',
            'X-Plex-Platform': 'Chrome',
            'X-Plex-Platform-Version': String(appVersion || '1'),
        };
    };

    const streamHeaders = (token, identity = 'player', deviceName = 'Portal Media Player') => ({
        ...playerHeaders(token, identity, deviceName),
        Accept: 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
        'X-Plex-Product': 'Plex Web',
        'X-Plex-Device': 'Chrome',
        'X-Plex-Platform': 'Chrome',
        'X-Plex-Platform-Version': '120.0',
        'X-Plex-Provides': 'player',
    });

    const addPlexIdentityParams = (params, headers, token, { transcodeProfile = true } = {}) => {
        params.set('X-Plex-Token', token);
        for (const key of [
            'X-Plex-Client-Identifier',
            'X-Plex-Product',
            'X-Plex-Platform',
            'X-Plex-Platform-Version',
            'X-Plex-Device',
            'X-Plex-Device-Name',
        ]) {
            if (headers[key]) params.set(key, headers[key]);
        }
        if (transcodeProfile) params.set('X-Plex-Client-Profile-Extra', HLS_CLIENT_PROFILE);
    };

    const playbackFor = async (req, serverToken) => {
        const memberToken = String(await resolveMemberPlexToken(req).catch(() => '') || '').trim();
        const token = memberToken || serverToken;
        const identity = identityKey(req);
        const userIdentity = memberToken ? identity : STREAM_IDENTITY;
        const deviceName = deviceNameFor(req);
        const serverHeaders = playerHeaders(serverToken, STREAM_IDENTITY, deviceName);
        const memberHeaders = memberToken ? playerHeaders(memberToken, identity, deviceName) : null;
        return {
            memberToken,
            token,
            streamToken: serverToken,
            identity: userIdentity,
            streamIdentity: STREAM_IDENTITY,
            headers: streamHeaders(token, userIdentity, deviceName),
            streamAuthHeaders: streamHeaders(serverToken, STREAM_IDENTITY, deviceName),
            metaHeaders: playerHeaders(token, userIdentity, deviceName),
            memberHeaders,
            serverHeaders,
            jsonAttempts: (urlForToken) => [
                { token, url: urlForToken(token), headers: playerHeaders(token, userIdentity, deviceName) },
                { token: serverToken, url: urlForToken(serverToken), headers: serverHeaders },
            ],
        };
    };

    const streamPairsFor = (playback) => {
        const pairs = [];
        const seen = new Set();
        const add = (token, identity, headers) => {
            const key = `${String(token || '')}\0${String(identity || '')}`;
            if (!token || seen.has(key)) return;
            seen.add(key);
            pairs.push({ token, identity, headers });
        };
        add(playback.token, playback.identity, playback.headers);
        add(playback.streamToken, playback.streamIdentity, playback.streamAuthHeaders);
        return pairs;
    };

    const prunePlaybackCaches = (now = Date.now()) => {
        for (const [key, row] of directPlayPartCache) {
            if (!row?.partId || now - Number(row.at || 0) > DIRECT_PLAY_PART_TTL_MS) {
                directPlayPartCache.delete(key);
            }
        }
        for (const [key, row] of hlsPlaylistCache) {
            if (row?.inflight) continue;
            if (!row?.body || now - Number(row.at || 0) > HLS_PLAYLIST_TTL_MS) {
                hlsPlaylistCache.delete(key);
            }
        }
    };

    const directPlayPartKey = (req, ratingKey, mediaIndex) => (
        `${identityKey(req)}|${ratingKey}|${Math.max(0, Number(mediaIndex) || 0)}`
    );

    const rememberDirectPlayPart = (req, ratingKey, mediaIndex, partId) => {
        const id = String(partId || '').replace(/\D/g, '');
        if (!id) return;
        prunePlaybackCaches();
        directPlayPartCache.set(directPlayPartKey(req, ratingKey, mediaIndex), { partId: id, at: Date.now() });
    };

    const recalledDirectPlayPart = (req, ratingKey, mediaIndex) => {
        const row = directPlayPartCache.get(directPlayPartKey(req, ratingKey, mediaIndex));
        if (!row?.partId || Date.now() - Number(row.at || 0) > DIRECT_PLAY_PART_TTL_MS) return '';
        return row.partId;
    };

    const hlsPlaylistCacheKey = ({
        ratingKey,
        session = '',
        quality = '',
        offset = '',
        resume = '',
        audioStreamID = '',
        subtitleStreamID = '',
        mediaIndex = '',
        copy = '',
    }) => [
        ratingKey,
        session,
        quality,
        offset,
        resume,
        audioStreamID,
        subtitleStreamID,
        mediaIndex,
        copy,
    ].join('|');

    const accessTokenFromReq = (req) => String(
        req?.query?.access_token
        || String(req?.get?.('authorization') || '').replace(/^Bearer\s+/i, '')
        || req?.cookies?.session
        || '',
    ).trim();

    const startPlexHlsPlaylist = async ({
        uri,
        playback,
        ratingKey,
        qualityId,
        offsetMs,
        audioStreamID,
        subtitleStreamID,
        transcodeSession,
        mediaIndex,
        allowCopy,
        accessToken,
    }) => {
        let lastDetail = '';
        const attempts = transcodeSettingsForQuality(qualityId)
            .filter((attempt) => allowCopy || !attempt.copy);
        for (const pair of streamPairsFor(playback)) {
            const attemptHeaders = {
                ...pair.headers,
                'X-Plex-Session-Identifier': transcodeSession,
            };
            for (const attempt of attempts) {
                const { copy, ...plexAttempt } = attempt;
                const params = new URLSearchParams({
                    hasMDE: '1',
                    path: `/library/metadata/${ratingKey}`,
                    mediaIndex,
                    partIndex: '0',
                    protocol: 'hls',
                    fastSeek: '1',
                    audioBoost: '100',
                    location: plexStreamLocation(uri),
                    addDebugOverlay: '0',
                    autoAdjustQuality: '0',
                    copyts: '1',
                    session: transcodeSession,
                    ...plexAttempt,
                    directPlay: '0',
                    directStream: subtitleStreamID ? '0' : plexAttempt.directStream,
                });
                if (audioStreamID) params.set('audioStreamID', audioStreamID);
                if (subtitleStreamID) {
                    params.set('subtitleStreamID', subtitleStreamID);
                    params.set('subtitles', 'burn');
                    params.set('advancedSubtitles', 'burn');
                    params.set('subtitleSize', '100');
                } else {
                    params.set('subtitleStreamID', '0');
                    params.set('subtitles', 'none');
                    params.set('advancedSubtitles', 'none');
                    params.set('subtitleSize', '0');
                }
                if (offsetMs) params.set('offset', String(Math.floor(offsetMs / 1000)));
                addPlexIdentityParams(params, attemptHeaders, pair.token, { transcodeProfile: !copy });
                const startUrl = `${uri}/video/:/transcode/universal/start.m3u8?${params.toString()}`;
                let plexRes;
                try {
                    plexRes = await plexFetch(fetchImpl, startUrl, attemptHeaders, {
                        timeoutMs: copy && plexAttempt.directStreamAudio !== '0' ? 8000 : 12000,
                    });
                } catch (error) {
                    lastDetail = /timeout|abort/i.test(String(error?.name || error?.message || ''))
                        ? 'Plex transcode start timed out.'
                        : String(error?.message || error || 'Plex transcode start failed.');
                    continue;
                }
                const body = await plexRes.text();
                if (plexRes.ok && isHlsPlaylist(body)) {
                    return {
                        body: rewritePlaylistUrls(
                            body,
                            uri,
                            '/api/media-player/proxy?u=',
                            plexRes.url || startUrl,
                            accessToken,
                        ),
                        lastDetail: '',
                    };
                }
                lastDetail = String(body || `HTTP ${plexRes.status}`).slice(0, 300);
                if (plexRes.status === 401 || plexRes.status === 403) break;
            }
        }
        return { body: '', lastDetail };
    };

    const loadHlsPlaylist = (opts) => {
        prunePlaybackCaches();
        const key = hlsPlaylistCacheKey(opts.cacheQuery || {});
        const hit = hlsPlaylistCache.get(key);
        if (hit?.body && Date.now() - Number(hit.at || 0) < HLS_PLAYLIST_TTL_MS) {
            return Promise.resolve({ body: hit.body, lastDetail: '' });
        }
        if (hit?.inflight) return hit.inflight;
        const inflight = startPlexHlsPlaylist(opts)
            .then((result) => {
                if (result?.body) hlsPlaylistCache.set(key, { body: result.body, at: Date.now() });
                else hlsPlaylistCache.delete(key);
                return result;
            })
            .catch((error) => {
                hlsPlaylistCache.delete(key);
                throw error;
            });
        hlsPlaylistCache.set(key, { inflight, at: Date.now() });
        return inflight;
    };

    const hlsQueryFromReq = (req, ratingKey) => {
        const rawOffset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
        const offsetMs = String(req.query.resume || '') === '1' ? clampPlayOffsetMs(rawOffset) : rawOffset;
        const qualityId = isPlayerQualityId(req.query.quality) ? String(req.query.quality) : ORIGINAL_PLAYER_QUALITY_ID;
        const audioStreamID = String(req.query.audioStreamID || '').replace(/\D/g, '');
        const subtitleStreamID = String(req.query.subtitleStreamID || '').replace(/\D/g, '');
        const transcodeSession = isPlaySessionId(req.query.session) ? String(req.query.session) : randomUUID();
        const mediaIndex = String(Math.max(0, Math.floor(Number(req.query.mediaIndex) || 0)));
        const allowCopy = qualityId !== ORIGINAL_PLAYER_QUALITY_ID || String(req.query.copy || '1') !== '0';
        return {
            ratingKey,
            qualityId,
            offsetMs,
            audioStreamID,
            subtitleStreamID,
            transcodeSession,
            mediaIndex,
            allowCopy,
            accessToken: accessTokenFromReq(req),
            cacheQuery: {
                ratingKey,
                session: transcodeSession,
                quality: qualityId,
                offset: String(offsetMs || 0),
                resume: String(req.query.resume || ''),
                audioStreamID,
                subtitleStreamID,
                mediaIndex,
                copy: allowCopy ? '1' : '0',
            },
        };
    };

    /** Never scrobble member progress with the owner token — that empties their Continue Watching. */
    const timelinePairsFor = (playback) => {
        if (playback?.memberToken) {
            return [{
                token: playback.memberToken,
                identity: playback.identity,
                headers: playback.headers,
            }];
        }
        return streamPairsFor(playback);
    };

    const jsonFor = (playback, pathAndQuery, opts) => plexJsonWithAuth(
        fetchImpl,
        playback.jsonAttempts((tok) => {
            const join = String(pathAndQuery).includes('?') ? '&' : '?';
            return `${pathAndQuery}${join}X-Plex-Token=${encodeURIComponent(tok)}`;
        }),
        opts,
    );

    const memberHistoryOnDeck = async (req, playback, { config, uri, sectionKey, onDeckWindowWeeks } = {}) => {
        const accountID = String(await resolveMemberAccountId(req, { config, uri }).catch(() => '') || '').trim();
        if (!accountID || isPlexOwnerLocalAccountId(accountID)) return [];
        const items = await fetchMemberOnDeckFromHistory({
            uri,
            token: playback.streamToken,
            accountID,
            headers: playback.serverHeaders,
            fetchImpl,
            timeoutMs: HOME_PLEX_TIMEOUT_MS,
            sectionKey,
            onDeckWindowWeeks: onDeckWindowWeeks ?? DEFAULT_ON_DECK_WINDOW_WEEKS,
        }).catch(() => []);
        return (Array.isArray(items) ? items : []).map((meta) => mapContinueWatchingItem(meta, config));
    };

    const resolveOnDeckWindowWeeks = async ({ uri, token, headers }) => {
        if (Date.now() - onDeckWindowCache.at < ON_DECK_WINDOW_CACHE_TTL_MS) {
            return onDeckWindowCache.weeks;
        }
        const weeks = await fetchPlexOnDeckWindowWeeks({
            uri,
            token,
            headers,
            fetchImpl,
            timeoutMs: 4000,
            fallback: onDeckWindowCache.weeks || DEFAULT_ON_DECK_WINDOW_WEEKS,
        });
        onDeckWindowCache = { at: Date.now(), weeks };
        return weeks;
    };

    const jsonForMember = (playback, pathAndQuery, opts) => {
        const memberToken = String(playback?.memberToken || '').trim();
        if (!memberToken || !playback.memberHeaders) return Promise.resolve(null);
        const join = String(pathAndQuery).includes('?') ? '&' : '?';
        return plexJson(
            fetchImpl,
            `${pathAndQuery}${join}X-Plex-Token=${encodeURIComponent(memberToken)}`,
            playback.memberHeaders,
            opts,
        );
    };

    const jsonForServer = (playback, pathAndQuery, opts) => {
        const serverToken = String(playback?.streamToken || '').trim();
        if (!serverToken || !playback.serverHeaders) return Promise.resolve(null);
        const join = String(pathAndQuery).includes('?') ? '&' : '?';
        return plexJson(
            fetchImpl,
            `${pathAndQuery}${join}X-Plex-Token=${encodeURIComponent(serverToken)}`,
            playback.serverHeaders,
            opts,
        );
    };

    const withPlex = async (res, fn) => {
        const config = await loadPortalConfig();
        if (String(config?.mediaServerType || 'plex').toLowerCase() !== 'plex') {
            return res.status(400).json({ error: 'Media Player currently supports Plex servers only.' });
        }
        if (!config?.plexToken || !config?.serverIdentifier) {
            return res.status(503).json({ error: 'Plex is not configured.' });
        }
        const uri = await getPlexConnectionUri(config);
        if (!uri) return res.status(503).json({ error: 'Cannot connect to Plex.' });
        try {
            return await fn({ config, uri, token: config.plexToken, headers: playerHeaders(config.plexToken) });
        } catch (error) {
            sendJsonError(res, 500, error, 'Plex request failed.');
        }
    };

    const resolvePlayableMeta = async (uri, playback, ratingKey, seedMeta = null) => {
        const meta = seedMeta || metadataList(await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
        ))[0];
        if (!meta) return null;
        const type = normalizePlayerItemType(meta);
        // Movies, episodes, tracks, and extras/trailers. Albums/artists resolve a child track.
        if (isPlayablePlexMeta(meta) && !['show', 'season', 'album', 'artist'].includes(type)) {
            return meta;
        }
        if (type === 'album' || type === 'artist') {
            const first = await jsonFor(
                playback,
                `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
            ).catch(() => null);
            return metadataList(first)[0] || null;
        }
        if (type !== 'show' && type !== 'season') return null;
        const unwatched = await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?unwatched=1&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
        ).catch(() => null);
        const nextUnwatched = metadataList(unwatched)[0];
        if (nextUnwatched) return nextUnwatched;
        const first = await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/allLeaves?X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
        ).catch(() => null);
        return metadataList(first)[0] || null;
    };

    const shuffleQueueItems = (rows) => {
        const copy = rows.slice();
        for (let index = copy.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            const current = copy[index];
            copy[index] = copy[swap];
            copy[swap] = current;
        }
        return copy;
    };

    const collectPlayableQueue = async (uri, playback, ratingKey, seedMeta = null) => {
        const meta = seedMeta || metadataList(await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
        ).catch(() => null))[0];
        if (!meta) return [];
        const item = mapPlayerItem(meta);
        const playable = (rows) => rows.filter((row) => (
            row.type === 'movie' || row.type === 'episode' || row.type === 'clip' || row.type === 'trailer' || row.type === 'track'
        ));
        if (item.type === 'movie' || item.type === 'episode' || item.type === 'clip' || item.type === 'trailer' || item.type === 'track') {
            return playable([item]);
        }
        const kidsOf = async (key, { leaves = false } = {}) => {
            const qs = leaves
                ? 'allLeaves?includeUserState=1&X-Plex-Container-Size=500'
                : 'children?includeUserState=1&X-Plex-Container-Size=500';
            const data = await jsonFor(
                playback,
                `${uri}/library/metadata/${encodeURIComponent(key)}/${qs}`,
            ).catch(() => null);
            return metadataList(data).map((row) => mapPlayerItem(row));
        };
        if (item.type === 'album') return playable(await kidsOf(ratingKey));
        if (item.type === 'artist') return playable(await kidsOf(ratingKey, { leaves: true }));
        if (item.type === 'season') return playable(await kidsOf(ratingKey));
        if (item.type === 'show') {
            const seasons = (await kidsOf(ratingKey)).filter((row) => row.type === 'season');
            const episodes = [];
            for (const season of seasons) {
                episodes.push(...await kidsOf(season.ratingKey));
            }
            return playable(episodes);
        }
        return playable(await kidsOf(ratingKey));
    };

    const fetchNeighborEpisode = async (uri, playback, ratingKey, direction) => {
        const data = await jsonFor(playback, `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`);
        const meta = metadataList(data)[0];
        const kind = normalizePlayerItemType(meta);
        if (!meta || (kind !== 'episode' && kind !== 'track')) return null;
        const music = kind === 'track';
        const kidsQs = music
            ? 'children?includeUserState=1&X-Plex-Container-Size=500'
            : 'children?excludeAllLeaves=1&X-Plex-Container-Size=500';
        const seasonKey = meta.parentRatingKey;
        if (seasonKey) {
            const seasonKids = await jsonFor(
                playback,
                `${uri}/library/metadata/${encodeURIComponent(seasonKey)}/${kidsQs}`,
            ).catch(() => null);
            const list = metadataList(seasonKids);
            const neighbor = direction > 0
                ? nextEpisodeInList(list, meta.ratingKey)
                : previousEpisodeInList(list, meta.ratingKey);
            if (neighbor) return neighbor;
        }
        const showKey = meta.grandparentRatingKey;
        if (!showKey || !seasonKey) return null;
        const seasons = metadataList(await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(showKey)}/children?excludeAllLeaves=1&X-Plex-Container-Size=100`,
        ).catch(() => null));
        const seasonIdx = seasons.findIndex((row) => String(row.ratingKey) === String(seasonKey));
        const neighborSeason = seasonIdx >= 0 ? seasons[seasonIdx + direction] : null;
        if (!neighborSeason?.ratingKey) return null;
        const kids = metadataList(await jsonFor(
            playback,
            `${uri}/library/metadata/${encodeURIComponent(neighborSeason.ratingKey)}/${kidsQs}`,
        ).catch(() => null));
        if (!kids.length) return null;
        return direction > 0 ? kids[0] : kids[kids.length - 1];
    };

    const fetchNextEpisode = (uri, playback, ratingKey) => (
        fetchNeighborEpisode(uri, playback, ratingKey, 1)
    );

    router.get('/me', requireAuth, requireMember, async (req, res) => {
        try {
            const profile = mapPlayerProfile({
                ...(await getMediaPlayerProfile(req)),
                isAdmin: !!req.user?.isAdmin,
            });
            res.json(profile);
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to load profile.' });
        }
    });

    router.get('/settings', requireAuth, requireMember, async (req, res) => {
        try {
            const settings = await getMediaPlayerSettings(req);
            res.json(settings);
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to load settings.' });
        }
    });

    router.put('/settings', requireAuth, requireMember, async (req, res) => {
        try {
            const settings = await saveMediaPlayerSettings(req, req.body || {});
            res.json({ ...normalizePlayerSettings(settings), saved: true });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to save settings.' });
        }
    });

    router.get('/home-hero-config', requireAuth, adminOnly, async (_req, res) => {
        try {
            const config = await loadPortalConfig();
            res.json({
                mode: normalizeMediaPlayerHomeHeroMode(config),
                seasonalInWindowOnly: config?.mediaPlayerHomeHeroSeasonalInWindowOnly === true,
                continueWatchingSeasonPoster: config?.mediaPlayerContinueWatchingSeasonPoster === true,
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load home hero settings.' });
        }
    });

    router.put('/home-hero-config', requireAuth, adminOnly, async (req, res) => {
        try {
            if (typeof savePortalConfig !== 'function') {
                return res.status(500).json({ error: 'Home hero settings cannot be saved.' });
            }
            const config = await loadPortalConfig();
            const mode = normalizeMediaPlayerHomeHeroMode({
                mediaPlayerHomeHeroMode: req.body?.mode != null
                    ? req.body.mode
                    : config.mediaPlayerHomeHeroMode,
                mediaPlayerHomeHeroEnabled: config.mediaPlayerHomeHeroEnabled,
            });
            const seasonalInWindowOnly = req.body?.seasonalInWindowOnly !== undefined
                ? !!req.body.seasonalInWindowOnly
                : config.mediaPlayerHomeHeroSeasonalInWindowOnly === true;
            const continueWatchingSeasonPoster = req.body?.continueWatchingSeasonPoster !== undefined
                ? !!req.body.continueWatchingSeasonPoster
                : config.mediaPlayerContinueWatchingSeasonPoster === true;
            const next = {
                ...config,
                mediaPlayerHomeHeroMode: mode,
                mediaPlayerHomeHeroSeasonalInWindowOnly: seasonalInWindowOnly,
                mediaPlayerHomeHeroEnabled: mode !== 'off',
                mediaPlayerContinueWatchingSeasonPoster: continueWatchingSeasonPoster,
            };
            await savePortalConfig(next);
            clearMediaPlayerHomeHeroCache();
            homeCache.clear();
            libraryHomeCache.clear();
            res.json({
                mode,
                seasonalInWindowOnly,
                continueWatchingSeasonPoster,
                saved: true,
            });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message || 'Failed to save home hero settings.' });
        }
    });

    const readHomeCache = (req) => {
        const key = homeCacheKey(req);
        const row = homeCache.get(key);
        if (!row) return null;
        const age = Date.now() - row.at;
        if (age > HOME_STALE_TTL_MS) {
            homeCache.delete(key);
            return null;
        }
        return { payload: row.payload, fresh: age <= HOME_CACHE_TTL_MS };
    };

    const writeHomeCache = (req, payload) => {
        const key = homeCacheKey(req);
        homeCache.set(key, { at: Date.now(), payload });
        if (homeCache.size <= 40) return;
        const oldest = homeCache.keys().next().value;
        if (oldest && oldest !== key) homeCache.delete(oldest);
    };

    const clearHomeCaches = (req) => {
        const key = homeCacheKey(req);
        homeCache.delete(key);
        for (const cacheKey of [...libraryHomeCache.keys()]) {
            if (String(cacheKey).startsWith(`${key}|`)) libraryHomeCache.delete(cacheKey);
        }
    };

    const trimCache = (cache, keepKey, max = 80) => {
        if (cache.size <= max) return;
        const oldest = cache.keys().next().value;
        if (oldest && oldest !== keepKey) cache.delete(oldest);
    };

    const readTtlCache = (cache, key, ttlMs) => {
        const row = cache.get(key);
        if (!row) return null;
        if (Date.now() - row.at > ttlMs) {
            cache.delete(key);
            return null;
        }
        return row.payload;
    };

    const writeTtlCache = (cache, key, payload) => {
        cache.set(key, { at: Date.now(), payload });
        trimCache(cache, key);
    };

    const libraryCacheKey = (req, sectionKey) => `${homeCacheKey(req)}|${sectionKey}`;

    const readLibraryHomeEntry = (key) => {
        const row = libraryHomeCache.get(key);
        if (!row?.payload) return null;
        const age = Date.now() - row.at;
        if (age > LIBRARY_HOME_STALE_TTL_MS) {
            libraryHomeCache.delete(key);
            return null;
        }
        return { payload: row.payload, fresh: age <= LIBRARY_HOME_CACHE_TTL_MS };
    };

    router.get('/home', requireAuth, requireMember, async (req, res) => {
        try {
            const cached = readHomeCache(req);
            if (cached?.fresh) return res.json(cached.payload);

            const buildHomePayload = async ({ config, uri, token, headers }) => {
                const hubQuery = `count=${HOME_HUB_COUNT}&includeMeta=1`;
                const hubOpts = { timeoutMs: HOME_PLEX_TIMEOUT_MS };
                // Overlap member-token resolve with server-token work (sections + OnDeckWindow).
                const sectionsPromise = plexJson(
                    fetchImpl,
                    `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`,
                    headers,
                    hubOpts,
                );
                const onDeckWindowPromise = resolveOnDeckWindowWeeks({ uri, token, headers });
                const playback = await playbackFor(req, token);
                // Fetch member + server hubs together so empty member hubs don't add a second RTT.
                const [
                    sectionsRes,
                    memberPromotedRes,
                    memberHomeRes,
                    onDeckRes,
                    onDeckWindowWeeks,
                    serverPromotedRes,
                    serverHomeRes,
                    serverAllRes,
                ] = await Promise.all([
                    sectionsPromise,
                    jsonForMember(playback, `${uri}/hubs/promoted?${hubQuery}`, hubOpts).catch(() => null),
                    jsonForMember(playback, `${uri}/hubs/home?${hubQuery}`, hubOpts).catch(() => null),
                    jsonForMember(
                        playback,
                        `${uri}/library/onDeck?X-Plex-Container-Size=24`,
                        hubOpts,
                    ).catch(() => null),
                    onDeckWindowPromise,
                    jsonForServer(playback, `${uri}/hubs/promoted?${hubQuery}`, hubOpts).catch(() => null),
                    jsonForServer(playback, `${uri}/hubs/home?${hubQuery}`, hubOpts).catch(() => null),
                    jsonForServer(playback, `${uri}/hubs?${hubQuery}`, hubOpts).catch(() => null),
                ]);
                const sections = (sectionsRes?.MediaContainer?.Directory || [])
                    .filter((dir) => ['movie', 'show', 'artist'].includes(dir.type))
                    .map(mapPlayerSection);

                const memberPromotedHubs = mapPlayerHomeHubs(memberPromotedRes?.MediaContainer?.Hub || [], config);
                const memberHomeHubs = mapPlayerHomeHubs(memberHomeRes?.MediaContainer?.Hub || [], config);
                const seenMemberHub = new Set(memberPromotedHubs.map((hub) => String(hub.identifier || '').toLowerCase()));
                let hubs = memberPromotedHubs.concat(memberHomeHubs.filter((hub) => {
                    const id = String(hub.identifier || '').toLowerCase();
                    if (!id || seenMemberHub.has(id)) return false;
                    seenMemberHub.add(id);
                    return true;
                }));
                const memberOwned = Boolean(hubs.length);
                if (!hubs.length) {
                    const rawHubs = [].concat(
                        serverPromotedRes?.MediaContainer?.Hub
                        || serverHomeRes?.MediaContainer?.Hub
                        || serverAllRes?.MediaContainer?.Hub
                        || [],
                    );
                    hubs = mapPlayerHomeHubs(rawHubs, config);
                }
                hubs = dedupeLibraryContinueWatchingHubs(hubs);
                hubs = await attachPlexHeroCoverArt(await markHeroCollectionHubs(hubs, async (id) => {
                    const data = await plexJson(
                        fetchImpl,
                        `${uri}/library/collections/${encodeURIComponent(id)}?X-Plex-Token=${encodeURIComponent(token)}`,
                        headers,
                        hubOpts,
                    ).catch(() => null);
                    const listed = metadataList(data);
                    if (listed[0]) return listed[0];
                    const directory = data?.MediaContainer?.Directory;
                    if (Array.isArray(directory)) return directory[0] || null;
                    return directory || null;
                }), { fetchImpl, uri, token, headers, hubOpts });
                hubs = mergeSameTitleHomeHubs(hubs);
                const onDeckItems = filterWithinOnDeckWindow(
                    dedupeItems(metadataList(onDeckRes).map((meta) => mapContinueWatchingItem(meta, config))),
                    onDeckWindowWeeks,
                );
                const memberHubWatching = filterWithinOnDeckWindow(
                    dedupeItems(
                        memberPromotedHubs.find((hub) => isLibraryContinueWatchingHub(hub))?.items
                        || memberHomeHubs.find((hub) => isLibraryContinueWatchingHub(hub))?.items
                        || [],
                    ),
                    onDeckWindowWeeks,
                );
                let continueWatching = onDeckItems.length ? onDeckItems : memberHubWatching;
                if (!continueWatching.length) {
                    // History fallback can be slow — never block the whole home page on it.
                    continueWatching = await Promise.race([
                        memberHistoryOnDeck(req, playback, {
                            config,
                            uri,
                            onDeckWindowWeeks,
                        }).catch(() => []),
                        new Promise((resolve) => {
                            setTimeout(() => resolve([]), HOME_HISTORY_TIMEOUT_MS);
                        }),
                    ]);
                }
                hubs = withMemberContinueWatching(hubs, continueWatching, { keepWhenEmpty: memberOwned });
                hubs = hubs.map((hub) => (
                    isLibraryContinueWatchingHub(hub)
                        ? { ...hub, items: filterWithinOnDeckWindow(hub.items || [], onDeckWindowWeeks) }
                        : hub
                ));
                let recentByLibrary = [];
                let playlists = [];
                if (!hubs.some((hub) => !isLibraryContinueWatchingHub(hub))) {
                    const savedSettings = await getMediaPlayerSettings(req).catch(() => normalizePlayerSettings());
                    const [playlistsRes, ...recentResults] = await Promise.all([
                        savedSettings.showPlaylists === false
                            ? Promise.resolve(null)
                            : jsonForMember(playback, `${uri}/playlists?playlistType=video&X-Plex-Container-Size=24`, hubOpts).catch(() => null),
                        ...sections.slice(0, 6).map((section) => plexJson(
                            fetchImpl,
                            `${uri}/library/sections/${encodeURIComponent(section.key)}/recentlyAdded?X-Plex-Container-Size=12&X-Plex-Token=${encodeURIComponent(token)}`,
                            headers,
                            hubOpts,
                        ).then((data) => ({ section, data })).catch(() => ({ section, data: null }))),
                    ]);
                    recentByLibrary = recentResults.map(({ section, data }) => ({
                        library: section,
                        items: dedupeItems(metadataList(data).map((meta) => mapRecentlyAddedItem(meta, section, config))),
                    })).filter((row) => row.items.length);
                    playlists = savedSettings.showPlaylists === false
                        ? []
                        : metadataList(playlistsRes)
                            .filter((meta) => String(meta.playlistType || meta.type || 'video').toLowerCase() !== 'audio')
                            .map((meta) => mapPlayerPlaylist(meta, config))
                            .filter((row) => row.ratingKey);
                    playlists = dedupeItems(playlists, 24);
                }

                return {
                    libraries: sections,
                    hubs,
                    continueWatching,
                    recentByLibrary,
                    playlists,
                };
            };

            // Stale-while-revalidate: paint last home immediately, refresh in the background.
            if (cached?.payload) {
                res.json(cached.payload);
                void withPlex({
                    status() { return this; },
                    json() { return this; },
                }, async (ctx) => {
                    kickPlayerPosters(ctx.uri, ctx.token, ctx.headers, firstScreenItems([
                        cached.payload.continueWatching,
                        ...(cached.payload.hubs || []),
                        ...(cached.payload.recentByLibrary || []),
                    ]));
                    const payload = await buildHomePayload(ctx);
                    writeHomeCache(req, payload);
                }).catch(() => undefined);
                return;
            }

            await withPlex(res, async (ctx) => {
                const payload = await buildHomePayload(ctx);
                kickPlayerPosters(ctx.uri, ctx.token, ctx.headers, firstScreenItems([
                    payload.continueWatching,
                    ...(payload.hubs || []),
                    ...(payload.recentByLibrary || []),
                ]));
                writeHomeCache(req, payload);
                res.json(payload);
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load Media Player home.' });
        }
    });

    router.get('/home-hero', requireAuth, requireMember, async (req, res) => {
        try {
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const effectiveMode = resolveEffectiveHeroMode(config);
                let continueWatchingItems = [];
                if (effectiveMode === 'continue_watching') {
                    const playback = await playbackFor(req, token);
                    const onDeckWindowWeeks = await resolveOnDeckWindowWeeks({ uri, token, headers });
                    const onDeckRes = await jsonForMember(
                        playback,
                        `${uri}/library/onDeck?X-Plex-Container-Size=24`,
                        { timeoutMs: HOME_PLEX_TIMEOUT_MS },
                    ).catch(() => null);
                    continueWatchingItems = filterWithinOnDeckWindow(
                        dedupeItems(metadataList(onDeckRes).map((meta) => mapContinueWatchingItem(meta, config))),
                        onDeckWindowWeeks,
                    );
                    if (!continueWatchingItems.length) {
                        continueWatchingItems = await memberHistoryOnDeck(req, playback, {
                            config,
                            uri,
                            onDeckWindowWeeks,
                        });
                    }
                }
                const payload = await buildMediaPlayerHomeHero({
                    config,
                    uri,
                    token,
                    headers,
                    fetchImpl,
                    plexJson,
                    mapPlayerItem,
                    force: String(req.query.refresh || '') === '1',
                    continueWatchingItems,
                });
                const artItems = payload.items || [];
                setTimeout(() => kickPlayerBackdrops(uri, token, headers, artItems, 4), 1200);
                res.json(payload);
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load Media Player hero.' });
        }
    });

    router.get('/search', requireAuth, requireMember, async (req, res) => {
        try {
            const query = String(req.query.q || '').trim();
            if (query.length < 2) return res.json({ results: [] });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const data = await plexJson(
                    fetchImpl,
                    `${uri}/hubs/search?query=${encodeURIComponent(query)}&limit=16&X-Plex-Token=${encodeURIComponent(token)}`,
                    headers,
                );
                const buckets = { person: [], show: [], movie: [], episode: [], other: [] };
                const seenPeople = new Set();
                for (const hub of data?.MediaContainer?.Hub || []) {
                    const peopleHub = isPlexPeopleSearchHub(hub);
                    const rows = [].concat(hub.Metadata || [], hub.Directory || []);
                    for (const meta of rows) {
                        const mediaType = String(meta.type || '').toLowerCase();
                        const isMediaRow = ['movie', 'show', 'episode', 'season', 'artist', 'album', 'track', 'playlist', 'collection'].includes(mediaType);
                        if (!isMediaRow && (isPlexPersonSearchHit(meta) || (peopleHub && (meta.id || meta.tag || meta.ratingKey)))) {
                            const person = mapPlayerPersonSearchHit(meta, config);
                            if (!person?.ratingKey) continue;
                            const dedupe = `${person.personId || ''}|${String(person.title || '').toLowerCase()}`;
                            if (seenPeople.has(dedupe)) continue;
                            seenPeople.add(dedupe);
                            buckets.person.push(person);
                            continue;
                        }
                        if (!['movie', 'show', 'episode', 'artist', 'album', 'playlist'].includes(meta.type)) continue;
                        const item = meta.type === 'playlist'
                            ? mapPlayerPlaylist(meta, config)
                            : mapPlayerItem(meta, config);
                        if (!item?.ratingKey) continue;
                        if (item.type === 'show') buckets.show.push(item);
                        else if (item.type === 'movie') buckets.movie.push(item);
                        else if (item.type === 'episode') buckets.episode.push(item);
                        else buckets.other.push(item);
                    }
                }
                res.json({
                    results: [
                        ...buckets.person.slice(0, 16),
                        ...buckets.show.slice(0, 16),
                        ...buckets.movie.slice(0, 16),
                        ...buckets.episode.slice(0, 16),
                        ...buckets.other.slice(0, 8),
                    ],
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Search failed.' });
        }
    });

    router.get('/libraries', requireAuth, requireMember, async (req, res) => {
        try {
            await withPlex(res, async ({ uri, token, headers }) => {
                const data = await plexJson(fetchImpl, `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`, headers);
                res.json({
                    libraries: (data?.MediaContainer?.Directory || [])
                        .filter((dir) => ['movie', 'show', 'artist'].includes(dir.type))
                        .map(mapPlayerSection),
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load libraries.' });
        }
    });

    router.get('/person/:actorId', requireAuth, requireMember, async (req, res) => {
        try {
            const actorId = String(req.params.actorId || '').trim();
            const name = String(req.query.name || '').trim();
            if (!actorId && !name) return res.status(400).json({ error: 'Invalid person.' });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const sectionsRes = await plexJson(fetchImpl, `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`, headers);
                const sections = (sectionsRes?.MediaContainer?.Directory || [])
                    .filter((dir) => dir.type === 'movie' || dir.type === 'show');
                const filters = actorQueryValues(actorId, name);
                const collected = [];
                for (const section of sections) {
                    for (const filter of filters) {
                        const data = await plexJson(
                            fetchImpl,
                            `${uri}/library/sections/${encodeURIComponent(section.key)}/all?actor=${encodeURIComponent(filter)}&X-Plex-Container-Start=0&X-Plex-Container-Size=100&X-Plex-Token=${encodeURIComponent(token)}`,
                            headers,
                        ).catch(() => null);
                        const metas = metadataList(data);
                        collected.push(...metas);
                        if (metas.length) break;
                    }
                }
                const seen = new Set();
                const items = collected.filter((meta) => {
                    const key = String(meta?.ratingKey || meta?.title || '').trim();
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).slice(0, 100).map((meta) => mapPlayerItem(meta, config));
                const person = pickPersonFromMetadata(collected, { actorId, name });
                kickPlayerPosters(uri, token, headers, firstScreenItems([items]));
                const profile = await resolvePlayerPersonProfile({
                    name: person.name || name,
                    knownTitles: items.map((row) => row.title),
                    tmdbApiKey: config?.tmdbApiKey,
                    fetchImpl,
                });
                res.json({ person, items, profile });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load person.' });
        }
    });

    router.get('/studio/:studioKey', requireAuth, requireMember, async (req, res) => {
        try {
            const studioKey = String(req.params.studioKey || '').trim();
            const name = String(req.query.name || '').trim();
            const sectionKey = String(req.query.section || '').replace(/\D/g, '');
            const mediaType = String(req.query.type || '').trim() === 'show' ? 'show'
                : String(req.query.type || '').trim() === 'movie' ? 'movie'
                    : '';
            if (!studioKey && !name) return res.status(400).json({ error: 'Invalid studio.' });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const sectionsRes = await plexJson(fetchImpl, `${uri}/library/sections?X-Plex-Token=${encodeURIComponent(token)}`, headers);
                const allVideoSections = (sectionsRes?.MediaContainer?.Directory || [])
                    .filter((dir) => dir.type === 'movie' || dir.type === 'show');
                const typedSections = mediaType
                    ? allVideoSections.filter((dir) => dir.type === mediaType)
                    : allVideoSections;
                const orderSections = (list) => [
                    ...list.filter((dir) => String(dir.key) === sectionKey),
                    ...list.filter((dir) => String(dir.key) !== sectionKey),
                ];
                let ordered = orderSections(typedSections.length ? typedSections : allVideoSections);

                // Resolve Plex facet keys by label — TMDB network ids rarely match local tag ids.
                const facetOptions = [];
                const facetSeen = new Set();
                await Promise.all(ordered.slice(0, 8).map(async (section) => {
                    await Promise.all(['studio', 'network'].map(async (facet) => {
                        const data = await plexJson(
                            fetchImpl,
                            `${uri}/library/sections/${encodeURIComponent(section.key)}/${facet}?X-Plex-Token=${encodeURIComponent(token)}`,
                            headers,
                            { timeoutMs: LIBRARY_PLEX_TIMEOUT_MS },
                        ).catch(() => null);
                        for (const row of mapPlayerFilterOptions(data)) {
                            const id = `${row.key}|${row.title}`;
                            if (facetSeen.has(id)) continue;
                            facetSeen.add(id);
                            facetOptions.push(row);
                        }
                    }));
                }));

                const filters = expandStudioQueryValues(studioKey, name, facetOptions);
                const paramsToTry = ['studio', 'network'];

                const collectForSections = async (sections, typeFilter) => {
                    const collected = [];
                    for (const section of sections) {
                        let found = false;
                        for (const param of paramsToTry) {
                            for (const filter of filters) {
                                const data = await plexJson(
                                    fetchImpl,
                                    `${uri}/library/sections/${encodeURIComponent(section.key)}/all?${param}=${encodeURIComponent(filter)}&X-Plex-Container-Start=0&X-Plex-Container-Size=500&X-Plex-Token=${encodeURIComponent(token)}`,
                                    headers,
                                ).catch(() => null);
                                const metas = metadataList(data).filter((meta) => (
                                    !typeFilter || String(meta?.type || '') === typeFilter
                                ));
                                collected.push(...metas);
                                if (metas.length) {
                                    found = true;
                                    break;
                                }
                            }
                            if (found) break;
                        }
                    }
                    return collected;
                };

                let collected = await collectForSections(ordered, mediaType || '');
                // Streaming logos often open from a movie page with type=movie, but the
                // brand lives on TV as network (or the other way around). Broaden once.
                if (!collected.length && mediaType) {
                    ordered = orderSections(allVideoSections);
                    collected = await collectForSections(ordered, '');
                }

                const seen = new Set();
                const items = collected.filter((meta) => {
                    const key = String(meta?.ratingKey || meta?.title || '').trim();
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).slice(0, 500).map((meta) => mapPlayerItem(meta, config));
                res.json({
                    studio: { key: studioKey || name, name: name || studioKey },
                    items,
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load studio.' });
        }
    });

    router.get('/libraries/:sectionKey/home', requireAuth, requireMember, async (req, res) => {
        try {
            const sectionKey = String(req.params.sectionKey || '').trim();
            if (!/^\d+$/.test(sectionKey)) return res.status(400).json({ error: 'Invalid library.' });
            const cacheKey = libraryCacheKey(req, sectionKey);
            const cached = readLibraryHomeEntry(cacheKey);
            if (cached?.fresh) return res.json(cached.payload);

            const buildLibraryHome = async ({ config, uri, token, headers }) => {
                const playback = await playbackFor(req, token);
                const hubOpts = { timeoutMs: LIBRARY_PLEX_TIMEOUT_MS };
                const sectionPath = encodeURIComponent(sectionKey);
                const onDeckWindowPromise = resolveOnDeckWindowWeeks({ uri, token, headers });
                const [sectionRes, hubsRes, onDeckRes, recentRes, newestRes] = await Promise.all([
                    plexJson(fetchImpl, `${uri}/library/sections/${sectionPath}?X-Plex-Token=${encodeURIComponent(token)}`, headers, hubOpts).catch(() => null),
                    plexJson(fetchImpl, `${uri}/hubs/sections/${sectionPath}?includeMeta=1&count=12&X-Plex-Token=${encodeURIComponent(token)}`, headers, hubOpts).catch(() => null),
                    jsonForMember(
                        playback,
                        `${uri}/library/sections/${sectionPath}/onDeck?X-Plex-Container-Size=16`,
                        hubOpts,
                    ).catch(() => null),
                    plexJson(fetchImpl, `${uri}/library/sections/${sectionPath}/recentlyAdded?X-Plex-Container-Size=18&X-Plex-Token=${encodeURIComponent(token)}`, headers, hubOpts).catch(() => null),
                    plexJson(fetchImpl, `${uri}/library/sections/${sectionPath}/newest?X-Plex-Container-Size=18&X-Plex-Token=${encodeURIComponent(token)}`, headers, hubOpts).catch(() => null),
                ]);
                const section = directoryList(sectionRes)[0] || sectionRes?.MediaContainer || {};
                const mapped = mapPlayerSection({ ...section, key: sectionKey });
                const onDeckWindowWeeks = await onDeckWindowPromise;
                let onDeckItems = filterWithinOnDeckWindow(
                    metadataList(onDeckRes).map((meta) => mapContinueWatchingItem(meta, config)),
                    onDeckWindowWeeks,
                );
                if (!onDeckItems.length) {
                    onDeckItems = await Promise.race([
                        memberHistoryOnDeck(req, playback, {
                            config,
                            uri,
                            sectionKey,
                            onDeckWindowWeeks,
                        }).catch(() => []),
                        new Promise((resolve) => {
                            setTimeout(() => resolve([]), HOME_HISTORY_TIMEOUT_MS);
                        }),
                    ]);
                }
                const mapRows = (payload) => metadataList(payload).map((meta) => mapRecentlyAddedItem(meta, mapped, config));
                const hubs = assembleLibraryHomeHubs({
                    sectionHubs: [].concat(hubsRes?.MediaContainer?.Hub || []),
                    onDeckItems,
                    recentItems: mapRows(recentRes),
                    newestItems: mapRows(newestRes),
                    sectionKey,
                    config,
                });
                return {
                    title: section.title || section.title1 || 'Library',
                    type: section.type || '',
                    hubs,
                };
            };

            if (cached?.payload) {
                res.json(cached.payload);
                void withPlex({
                    status() { return this; },
                    json() { return this; },
                }, async (ctx) => {
                    kickPlayerPosters(
                        ctx.uri,
                        ctx.token,
                        ctx.headers,
                        firstScreenItems(cached.payload.hubs),
                    );
                    const payload = await buildLibraryHome(ctx);
                    writeTtlCache(libraryHomeCache, cacheKey, payload);
                }).catch(() => undefined);
                return;
            }

            await withPlex(res, async (ctx) => {
                const payload = await buildLibraryHome(ctx);
                kickPlayerPosters(ctx.uri, ctx.token, ctx.headers, firstScreenItems(payload.hubs));
                writeTtlCache(libraryHomeCache, cacheKey, payload);
                res.json(payload);
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load library home.' });
        }
    });

    router.get('/libraries/:sectionKey/filters', requireAuth, requireMember, async (req, res) => {
        try {
            const sectionKey = String(req.params.sectionKey || '').trim();
            if (!/^\d+$/.test(sectionKey)) return res.status(400).json({ error: 'Invalid library.' });
            const cacheKey = libraryCacheKey(req, `filters:${sectionKey}`);
            const cached = readTtlCache(libraryFiltersCache, cacheKey, LIBRARY_FILTERS_CACHE_TTL_MS);
            if (cached) return res.json(cached);
            await withPlex(res, async ({ uri, token, headers }) => {
                const filterUrl = (facet) => (
                    `${uri}/library/sections/${encodeURIComponent(sectionKey)}/${facet}?X-Plex-Token=${encodeURIComponent(token)}`
                );
                const hubOpts = { timeoutMs: LIBRARY_PLEX_TIMEOUT_MS };
                const [genreRes, decadeRes, resolutionRes, studioRes] = await Promise.all([
                    plexJson(fetchImpl, filterUrl('genre'), headers, hubOpts).catch(() => null),
                    plexJson(fetchImpl, filterUrl('decade'), headers, hubOpts).catch(() => null),
                    plexJson(fetchImpl, filterUrl('resolution'), headers, hubOpts).catch(() => null),
                    plexJson(fetchImpl, filterUrl('studio'), headers, hubOpts).catch(() => null),
                ]);
                const payload = {
                    genres: mapPlayerFilterOptions(genreRes),
                    decades: mapPlayerFilterOptions(decadeRes),
                    resolutions: mapPlayerFilterOptions(resolutionRes),
                    studios: mapPlayerFilterOptions(studioRes),
                };
                writeTtlCache(libraryFiltersCache, cacheKey, payload);
                res.json(payload);
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load filters.' });
        }
    });

    router.get('/libraries/:sectionKey/collections', requireAuth, requireMember, async (req, res) => {
        try {
            const sectionKey = String(req.params.sectionKey || '').trim();
            if (!/^\d+$/.test(sectionKey)) return res.status(400).json({ error: 'Invalid library.' });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const data = await plexJson(
                    fetchImpl,
                    `${uri}/library/sections/${encodeURIComponent(sectionKey)}/collections?X-Plex-Container-Size=200&X-Plex-Token=${encodeURIComponent(token)}`,
                    headers,
                );
                const container = data?.MediaContainer || {};
                res.json({
                    title: container.title1 || container.librarySectionTitle || 'Collections',
                    items: metadataList(data).map((meta) => mapPlayerItem({ ...meta, type: meta.type || 'collection' }, config)),
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load collections.' });
        }
    });

    router.get('/libraries/:sectionKey', requireAuth, requireMember, async (req, res) => {
        try {
            const sectionKey = String(req.params.sectionKey || '').trim();
            if (!/^\d+$/.test(sectionKey)) return res.status(400).json({ error: 'Invalid library.' });
            const start = Math.max(0, Number(req.query.start) || 0);
            const size = Math.min(100, Math.max(1, Number(req.query.size) || 50));
            const sort = PLAYER_LIBRARY_SORT_IDS.has(String(req.query.sort || '')) ? String(req.query.sort) : 'addedAt:desc';
            const genre = String(req.query.genre || '').trim();
            const decade = String(req.query.decade || '').trim();
            const resolution = String(req.query.resolution || '').trim();
            const studio = String(req.query.studio || '').trim();
            const unwatched = String(req.query.unwatched || '') === '1';
            const inProgress = String(req.query.inProgress || '') === '1';
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const params = new URLSearchParams({
                    'X-Plex-Container-Start': String(start),
                    'X-Plex-Container-Size': String(size),
                    sort,
                    'X-Plex-Token': token,
                });
                if (genre) params.set('genre', genre);
                if (decade) params.set('decade', decade);
                if (resolution) params.set('resolution', resolution);
                if (studio) params.set('studio', studio);
                if (inProgress) params.set('filters', 'inProgress=1');
                else if (unwatched) params.set('unwatched', '1');
                const data = await plexJson(
                    fetchImpl,
                    `${uri}/library/sections/${encodeURIComponent(sectionKey)}/all?${params.toString()}`,
                    headers,
                );
                const container = data?.MediaContainer || {};
                res.json({
                    title: container.title1 || container.librarySectionTitle || 'Library',
                    type: container.viewGroup || container.librarySectionType || '',
                    total: Number(container.totalSize || container.size || 0),
                    items: metadataList(data).map((meta) => mapPlayerItem(meta, config)),
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load library.' });
        }
    });

    router.get('/collection/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            const sectionHint = String(req.query.section || '').replace(/\D/g, '');
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid collection.' });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const plexToken = token;
                const plexHeaders = headers;
                const tokenQs = `X-Plex-Token=${encodeURIComponent(plexToken)}`;

                // Overview collection pills often carry the tag/filter id, which is not
                // always a /library/metadata ratingKey — try several Plex shapes.
                let metaRes = await plexJsonOrNull(
                    fetchImpl,
                    `${uri}/library/metadata/${encodeURIComponent(ratingKey)}?includeChildren=1&includeGuids=1&${tokenQs}`,
                    plexHeaders,
                );
                if (!metaRes) {
                    metaRes = await plexJsonOrNull(
                        fetchImpl,
                        `${uri}/library/collections/${encodeURIComponent(ratingKey)}?includeChildren=1&includeGuids=1&${tokenQs}`,
                        plexHeaders,
                    );
                }

                let meta = metadataList(metaRes)[0] || null;
                let sectionId = String(meta?.librarySectionID || sectionHint || '').replace(/\D/g, '');

                const matchCollectionRow = (rows) => (Array.isArray(rows) ? rows : []).find((row) => {
                    const key = String(row?.ratingKey || '').trim();
                    const index = row?.index != null ? String(row.index).trim() : '';
                    return key === ratingKey || index === ratingKey;
                }) || null;

                if (!meta && sectionId) {
                    const listed = await plexJsonOrNull(
                        fetchImpl,
                        `${uri}/library/sections/${encodeURIComponent(sectionId)}/collections?X-Plex-Container-Size=500&${tokenQs}`,
                        plexHeaders,
                    );
                    const hit = matchCollectionRow(metadataList(listed));
                    if (hit) {
                        meta = hit;
                        sectionId = String(hit.librarySectionID || sectionId).replace(/\D/g, '');
                        metaRes = listed;
                    }
                }

                if (!meta) {
                    const sectionsRes = await plexJson(
                        fetchImpl,
                        `${uri}/library/sections?${tokenQs}`,
                        plexHeaders,
                    );
                    const sections = (sectionsRes?.MediaContainer?.Directory || [])
                        .filter((dir) => ['movie', 'show'].includes(dir.type))
                        .map((dir) => String(dir.key || '').trim())
                        .filter((key) => /^\d+$/.test(key));
                    const ordered = sectionId
                        ? [sectionId, ...sections.filter((id) => id !== sectionId)]
                        : sections;
                    for (const section of ordered) {
                        const listed = await plexJsonOrNull(
                            fetchImpl,
                            `${uri}/library/sections/${encodeURIComponent(section)}/collections?X-Plex-Container-Size=500&${tokenQs}`,
                            plexHeaders,
                        );
                        const hit = matchCollectionRow(metadataList(listed));
                        if (hit) {
                            meta = hit;
                            sectionId = section;
                            metaRes = listed;
                            break;
                        }
                    }
                    if (!meta) {
                        // Tag ids from item Collection[] often only work as section filters.
                        for (const section of ordered) {
                            const filtered = await plexJsonOrNull(
                                fetchImpl,
                                `${uri}/library/sections/${encodeURIComponent(section)}/all?collection=${encodeURIComponent(ratingKey)}&X-Plex-Container-Start=0&X-Plex-Container-Size=1&${tokenQs}`,
                                plexHeaders,
                            );
                            const total = Number(
                                filtered?.MediaContainer?.totalSize
                                || filtered?.MediaContainer?.size
                                || metadataList(filtered).length
                                || 0,
                            );
                            if (total > 0 || metadataList(filtered).length) {
                                sectionId = section;
                                meta = {
                                    ratingKey,
                                    title: 'Collection',
                                    type: 'collection',
                                    librarySectionID: section,
                                    key: `/library/sections/${section}/all?collection=${ratingKey}`,
                                };
                                metaRes = null;
                                break;
                            }
                        }
                    }
                }

                if (!meta) return res.status(404).json({ error: 'Collection not found.' });
                if (!meta.librarySectionID && sectionId) meta = { ...meta, librarySectionID: sectionId };

                const seen = new Set();
                const takeChildren = (payload) => {
                    const rows = [];
                    for (const row of collectionChildItems(payload, String(meta.ratingKey || ratingKey))) {
                        const key = String(row?.ratingKey || '').trim();
                        if (!key || seen.has(key)) continue;
                        seen.add(key);
                        rows.push(row);
                    }
                    return rows;
                };

                let childMetas = takeChildren(metaRes);
                const randomOrder = isRandomOrderSource(meta);
                if (!childMetas.length) {
                    const paths = collectionChildPaths(meta, String(meta.ratingKey || ratingKey));
                    // Prefer section filter with the original tag id when it differs from ratingKey.
                    if (sectionId && String(meta.ratingKey || '') !== ratingKey) {
                        paths.unshift(`/library/sections/${sectionId}/all?collection=${encodeURIComponent(ratingKey)}`);
                    }
                    for (const path of paths) {
                        const pagePath = randomOrder ? withPlexSortParam(path, 'random') : path;
                        for (let start = 0; start < 2000; start += 500) {
                            const page = await plexJsonOrNull(
                                fetchImpl,
                                `${uri}${withPlexContainerParams(pagePath, plexToken, { start, size: 500 })}`,
                                plexHeaders,
                            );
                            const rows = takeChildren(page);
                            childMetas = childMetas.concat(rows);
                            const total = Number(page?.MediaContainer?.totalSize || page?.MediaContainer?.size || rows.length);
                            if (!rows.length || childMetas.length >= total || rows.length < 500) break;
                        }
                        if (childMetas.length) break;
                    }
                }

                let children = childMetas.map((row) => mapPlayerItem(row, config));
                if (randomOrder && children.length > 1) children = shuffleRows(children);
                res.json({
                    item: mapPlayerItem({ ...meta, type: meta.type || 'collection' }, config),
                    children,
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load collection.' });
        }
    });

    router.get('/hub', requireAuth, requireMember, async (req, res) => {
        try {
            const rawPath = String(safePlexLibraryPath(req.query.path || '') || '');
            const qIndex = rawPath.indexOf('?');
            const path = qIndex >= 0 ? rawPath.slice(0, qIndex) : rawPath;
            if (!path) return res.status(400).json({ error: 'Invalid row.' });
            if (/\/file$|\/parts\/|\/transcode/i.test(path)) {
                return res.status(400).json({ error: 'Invalid row.' });
            }
            const identifier = String(req.query.identifier || req.query.id || '').trim();
            const sort = qIndex >= 0
                ? String(new URLSearchParams(rawPath.slice(qIndex + 1)).get('sort') || '').trim()
                : '';
            const randomOrder = /^random$/i.test(sort) || isRandomOrderSource({ hubIdentifier: identifier, key: rawPath });
            const pagePath = randomOrder ? withPlexSortParam(path, 'random') : (sort ? withPlexSortParam(path, sort) : path);
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const items = [];
                const seen = new Set();
                let title = String(req.query.title || '').trim();
                for (let start = 0; start < 2000; start += 100) {
                    const page = await plexJsonOrNull(
                        fetchImpl,
                        `${uri}${withPlexContainerParams(pagePath, token, { start, size: 100 })}`,
                        headers,
                    );
                    if (!page) break;
                    const mc = page.MediaContainer || {};
                    if (!title) {
                        title = String(mc.title2 || mc.title1 || mc.hubTitle || '').trim();
                    }
                    const rows = plexContainerItems(page);
                    let added = 0;
                    for (const meta of rows) {
                        const item = mapLibraryHubItem(meta, {
                            hubIdentifier: identifier || path,
                            key: path,
                        }, config);
                        const key = item?.dedupeKey || item?.ratingKey;
                        if (!key || seen.has(key)) continue;
                        seen.add(key);
                        items.push(item);
                        added += 1;
                    }
                    const total = Number(mc.totalSize || mc.size || items.length);
                    if (!added || items.length >= total || rows.length < 100) break;
                }
                res.json({
                    title: title || 'Library',
                    items: randomOrder && items.length > 1 ? shuffleRows(items) : items,
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load row.' });
        }
    });

    router.get('/next/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const next = await fetchNextEpisode(uri, playback, ratingKey);
                if (!next) return res.json({ item: null });
                res.json({ item: mapPlayerItem(next, config) });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load next episode.' });
        }
    });

    router.get('/neighbors/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const [previous, next] = await Promise.all([
                    fetchNeighborEpisode(uri, playback, ratingKey, -1),
                    fetchNeighborEpisode(uri, playback, ratingKey, 1),
                ]);
                res.json({
                    previous: previous ? mapPlayerItem(previous, config) : null,
                    next: next ? mapPlayerItem(next, config) : null,
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load episodes.' });
        }
    });

    const ITEM_META_TIMEOUT_MS = 12000;
    const ITEM_SIDE_TIMEOUT_MS = 3500;

    const embeddedMetaChildren = (meta) => {
        const kids = meta?.Children;
        if (!kids) return [];
        return [].concat(kids.Metadata || [], kids.Directory || []).filter((row) => row?.ratingKey);
    };

    router.get('/item/:ratingKey/more', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const tok = encodeURIComponent(token);
                const extrasUrl = `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/extras?X-Plex-Token=${tok}`;
                const relatedUrl = `${uri}/hubs/metadata/${encodeURIComponent(ratingKey)}/related?count=16&includeImages=1&includeGuids=1&X-Plex-Token=${tok}`;
                const sideOpts = { timeoutMs: ITEM_SIDE_TIMEOUT_MS };
                const onDeckPromise = playbackFor(req, token)
                    .then(async (playback) => {
                        const metaData = await jsonFor(
                            playback,
                            `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
                            sideOpts,
                        ).catch(() => null);
                        const meta = metadataList(metaData)[0];
                        if (!meta) return null;
                        const type = normalizePlayerItemType(meta);
                        if (type !== 'show' && type !== 'season') return null;
                        const playable = await resolvePlayableMeta(uri, playback, ratingKey, meta);
                        if (playable && String(playable.type || '') === 'episode') {
                            return mapPlayerItem(playable, config);
                        }
                        return null;
                    })
                    .catch(() => null);
                const [extrasRes, relatedRes, onDeck] = await Promise.all([
                    plexJson(fetchImpl, extrasUrl, headers, sideOpts).catch(() => null),
                    plexJson(fetchImpl, relatedUrl, headers, sideOpts).catch(() => null),
                    onDeckPromise,
                ]);
                let extras = mapPlayerExtras(listPlayerExtraMetas(extrasRes), config)
                    .filter((row) => row.ratingKey !== ratingKey);
                if (!extras.length) {
                    const extraMeta = await plexJson(
                        fetchImpl,
                        `${uri}/library/metadata/${encodeURIComponent(ratingKey)}?includeExtras=1&includeGuids=1&X-Plex-Token=${tok}`,
                        headers,
                        sideOpts,
                    ).catch(() => extrasRes);
                    extras = mapPlayerExtras(listPlayerExtraMetas(extraMeta), config)
                        .filter((row) => row.ratingKey !== ratingKey);
                }
                const related = mapPlayerHubs(
                    [].concat(relatedRes?.MediaContainer?.Hub || []),
                    config,
                );
                res.json({ extras, related, onDeck });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load related titles.' });
        }
    });

    router.get('/item/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            const coreOnly = String(req.query.core || '') === '1';
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const tok = encodeURIComponent(token);
                // Slim metadata: skip includeExtras/includeRelated (fetched separately / deferred).
                const metaUrl = `${uri}/library/metadata/${encodeURIComponent(ratingKey)}?includeChildren=1&includeGuids=1&includeImages=1&includeMarkers=1&includeUserState=1&X-Plex-Token=${tok}`;
                const data = await plexJson(fetchImpl, metaUrl, headers, { timeoutMs: ITEM_META_TIMEOUT_MS });
                const meta = metadataList(data)[0];
                if (!meta) return res.status(404).json({ error: 'Title not found.' });
                const item = mapPlayerItemDetails(meta, config);
                kickPlayerBackdrops(uri, token, headers, [item], 1);
                const showKey = item.type === 'season' ? item.parentRatingKey : item.grandparentRatingKey;
                const needsShow = (item.type === 'episode' || item.type === 'season') && showKey;
                const musicParentKey = item.type === 'track' ? item.parentRatingKey : null;
                const needsChildren = item.type === 'show'
                    || item.type === 'season'
                    || item.type === 'artist'
                    || item.type === 'album'
                    || (item.type === 'track' && !!musicParentKey);
                const embedded = needsChildren && item.type !== 'track' ? embeddedMetaChildren(meta) : [];
                const showUrl = needsShow
                    ? `${uri}/library/metadata/${encodeURIComponent(showKey)}?includeGuids=1&includeImages=1&X-Plex-Token=${tok}`
                    : null;
                const childrenKey = musicParentKey || ratingKey;
                const excludeLeaves = item.type === 'show' || item.type === 'season' || item.type === 'artist';
                // Albums/tracks must keep leaves so the track list is returned.
                const childrenUrl = needsChildren && (embedded.length === 0 || item.type === 'season' || item.type === 'album' || item.type === 'track')
                    ? `${uri}/library/metadata/${encodeURIComponent(childrenKey)}/children?${excludeLeaves ? 'excludeAllLeaves=1&' : ''}includeUserState=1&X-Plex-Container-Size=500&X-Plex-Token=${tok}`
                    : null;
                const extrasUrl = `${uri}/library/metadata/${encodeURIComponent(ratingKey)}/extras?X-Plex-Token=${tok}`;
                const relatedUrl = `${uri}/hubs/metadata/${encodeURIComponent(ratingKey)}/related?count=16&includeImages=1&includeGuids=1&X-Plex-Token=${tok}`;
                const sideOpts = { timeoutMs: ITEM_SIDE_TIMEOUT_MS };
                // Core path skips on-deck (extra Plex round-trips). /more fills it in after paint.
                const onDeckPromise = (!coreOnly && needsChildren)
                    ? playbackFor(req, token)
                        .then((playback) => (playback
                            ? resolvePlayableMeta(uri, playback, ratingKey, meta)
                            : null))
                        .catch(() => null)
                    : Promise.resolve(null);

                const [showData, kids, extrasRes, relatedRes, playable] = await Promise.all([
                    showUrl
                        ? plexJson(fetchImpl, showUrl, headers, { timeoutMs: ITEM_META_TIMEOUT_MS }).catch(() => null)
                        : null,
                    childrenUrl
                        ? plexJson(fetchImpl, childrenUrl, headers, { timeoutMs: ITEM_META_TIMEOUT_MS }).catch(() => null)
                        : null,
                    coreOnly
                        ? null
                        : plexJson(fetchImpl, extrasUrl, headers, sideOpts).catch(() => null),
                    coreOnly
                        ? null
                        : plexJson(fetchImpl, relatedUrl, headers, sideOpts).catch(() => null),
                    onDeckPromise,
                ]);

                if (needsShow) {
                    const show = metadataList(showData)[0];
                    if (show) applyShowMetaToPlayerChild(item, mapPlayerItemDetails(show, config));
                }

                let children = [];
                if (needsChildren) {
                    const fetched = metadataList(kids);
                    const source = fetched.length ? fetched : embedded;
                    children = source.map((row) => mapPlayerItem({
                        ...row,
                        parentThumb: row.parentThumb || row.grandparentThumb || item.thumb,
                        parentArt: row.parentArt || row.grandparentArt || item.art,
                        grandparentThumb: row.grandparentThumb || item.thumb,
                        grandparentArt: row.grandparentArt || item.art,
                        parentTitle: row.parentTitle || item.title,
                    }, config));
                }

                const extras = coreOnly
                    ? []
                    : mapPlayerExtras(
                        listPlayerExtraMetas(extrasRes).length
                            ? listPlayerExtraMetas(extrasRes)
                            : listPlayerExtraMetas({ MediaContainer: { Metadata: [meta] } }),
                        config,
                    ).filter((row) => row.ratingKey !== item.ratingKey);
                const related = coreOnly
                    ? []
                    : mapPlayerHubs(
                        [].concat(relatedRes?.MediaContainer?.Hub || meta.Related?.Hub || []),
                        config,
                    );

                let onDeck = null;
                if (playable && String(playable.type || '') === 'episode') {
                    onDeck = mapPlayerItem(playable, config);
                }
                res.json({ item, children, extras, related, onDeck });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load title.' });
        }
    });

    const playInput = (req) => ({
        ...(req.query && typeof req.query === 'object' ? req.query : {}),
        ...(req.body && typeof req.body === 'object' ? req.body : {}),
    });

    const handlePlay = async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            const input = playInput(req);
            await withPlex(res, async ({ config, uri, token, headers }) => {
                const playback = await playbackFor(req, token);
                const [data, savedSettings] = await Promise.all([
                    jsonFor(
                        playback,
                        `${uri}/library/metadata/${encodeURIComponent(ratingKey)}?includeMarkers=1&includeUserState=1`,
                        { timeoutMs: 12000 },
                    ),
                    getMediaPlayerSettings(req).catch(() => normalizePlayerSettings()),
                ]);
                const meta = metadataList(data)[0];
                const item = mapPlayerItem(meta, config);
                if (!item.canPlay) {
                    return res.status(400).json({ error: 'This title cannot be played yet. Open a movie, episode, album, or track.' });
                }
                const playable = await resolvePlayableMeta(uri, playback, ratingKey, meta);
                if (!playable) {
                    return res.status(400).json({ error: 'Nothing left to play in this title.' });
                }
                let playableMeta = playable;
                if (String(playable.ratingKey) !== String(ratingKey)) {
                    const playableData = await jsonFor(
                        playback,
                        `${uri}/library/metadata/${encodeURIComponent(playable.ratingKey)}?includeMarkers=1&includeUserState=1`,
                    ).catch(() => null);
                    playableMeta = metadataList(playableData)[0] || playable;
                }
                const mediaIndex = pickMediaIndex(input.mediaIndex, playableMeta);
                const selected = withSelectedMedia(playableMeta, mediaIndex);
                const playableItem = mapPlayerItem(selected, config);
                const offset = resolvePlayOffsetMs(
                    input.offsetMs,
                    playableItem.viewOffsetMs || 0,
                    playableItem.durationMs,
                );
                const sessionId = randomUUID();
                const capsHint = normalizePlaybackCaps(input);
                const options = mapPlayerPlaybackOptions(selected, {
                    audioLanguage: input.audioLanguage ?? savedSettings.audioLanguage,
                    subtitleMode: input.subtitleMode ?? savedSettings.subtitleMode,
                    // Image subs (PGS/VobSub) force a burn-in transcode. On TV that
                    // can sit on a spinner for minutes — start Direct Play without them.
                    allowImageSubtitles: capsHint.client === 'web',
                });
                const requestedAudio = String(input.audioStreamId || input.audioStreamID || '').replace(/\D/g, '');
                if (requestedAudio && (options.audioTracks || []).some((row) => String(row.id) === requestedAudio)) {
                    options.audioStreamId = requestedAudio;
                }
                const hasExplicitSub = Object.prototype.hasOwnProperty.call(input, 'subtitleStreamId')
                    || Object.prototype.hasOwnProperty.call(input, 'subtitleStreamID');
                if (hasExplicitSub) {
                    const requestedSub = String(input.subtitleStreamId ?? input.subtitleStreamID ?? '').replace(/\D/g, '');
                    if (!requestedSub || requestedSub === '0') {
                        options.subtitleStreamId = null;
                    } else if ((options.subtitles || []).some((row) => String(row.id) === requestedSub)) {
                        options.subtitleStreamId = requestedSub;
                    }
                } else if (capsHint.client !== 'web' && options.subtitleStreamId) {
                    const sub = (options.subtitles || []).find((row) => String(row.id) === String(options.subtitleStreamId));
                    if (subtitleCodecNeedsBurn(sub?.codec)) options.subtitleStreamId = null;
                }
                const requestedQuality = String(input.qualityId || '');
                const qualityId = isPlayerQualityId(requestedQuality) ? requestedQuality : options.qualityId;
                const caps = normalizePlaybackCaps({
                    ...input,
                    subtitleStreamId: options.subtitleStreamId,
                });
                if (!requestedAudio && caps.client === 'android') {
                    const dpAudio = pickDirectPlayAudioStreamId(selected, caps);
                    if (dpAudio) options.audioStreamId = dpAudio;
                }
                const allowHevc = caps.allowHevc;
                const allowAc3 = caps.allowAc3;
                const allowNativeHls = input.canPlayNativeHls === true
                    || input.canPlayNativeHls === 'true'
                    || input.canPlayNativeHls === '1'
                    || caps.client !== 'web';
                const subtitleStreamId = options.subtitleStreamId;
                const useDirectFile = (qualityId === ORIGINAL_PLAYER_QUALITY_ID || isAudioOnlyPlexMeta(selected))
                    && canHttpDirectPlay(selected, { ...caps, audioStreamId: options.audioStreamId });
                const copyOriginal = qualityId !== ORIGINAL_PLAYER_QUALITY_ID
                    || !isHevcVideo(selected)
                    || (allowHevc && allowNativeHls);
                const srcOpts = {
                    sessionId,
                    offsetMs: offset,
                    qualityId,
                    audioStreamId: options.audioStreamId,
                    subtitleStreamId,
                    resume: true,
                    copy: copyOriginal,
                    mediaIndex,
                    client: caps.client,
                    allowHevc,
                    allowAc3,
                    textSubtitles: caps.textSubtitles,
                };
                if (useDirectFile) {
                    rememberDirectPlayPart(req, playableItem.ratingKey, mediaIndex, pickPlayerPartId(selected));
                }
                res.json({
                    sessionId,
                    item: playableItem,
                    src: useDirectFile
                        ? buildPlayerFileSrc(playableItem.ratingKey, srcOpts)
                        : buildPlayerHlsSrc(playableItem.ratingKey, srcOpts),
                    offsetMs: offset,
                    ...options,
                    qualityId,
                    mediaIndex,
                    versions: mapPlayerVersions(playableMeta),
                    markers: mapPlayerMarkers(playableMeta),
                    playbackMode: mapPlayerPlaybackMode({ useDirectFile, copyOriginal, qualityId }),
                    source: mapPlayerPlaybackSource(selected),
                    canDirectPlay: canHttpDirectPlay(selected, { ...input, subtitleStreamId: '' }),
                    canCopyOriginal: copyOriginal,
                    client: caps.client,
                });
                if (!useDirectFile) {
                    const hlsOpts = hlsQueryFromReq({
                        ...req,
                        query: {
                            session: sessionId,
                            offset: String(offset || 0),
                            resume: '1',
                            quality: qualityId,
                            copy: copyOriginal ? '1' : '0',
                            mediaIndex: String(mediaIndex || 0),
                            audioStreamID: String(options.audioStreamId || '').replace(/\D/g, ''),
                            subtitleStreamID: String(subtitleStreamId || '').replace(/\D/g, ''),
                            access_token: accessTokenFromReq(req),
                        },
                    }, playableItem.ratingKey);
                    void loadHlsPlaylist({ uri, playback, ...hlsOpts }).catch(() => null);
                }
            });
        } catch (error) {
            sendJsonError(res, 500, error, 'Failed to start playback.');
        }
    };

    router.post('/play/:ratingKey', requireAuth, requireMember, handlePlay);
    router.get('/play/:ratingKey', requireAuth, requireMember, handlePlay);

    router.get('/queue/shuffle/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const items = await collectPlayableQueue(uri, playback, ratingKey);
                res.json({ items: shuffleQueueItems(items) });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to build shuffle queue.' });
        }
    });

    router.get('/queue/from/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const seed = metadataList(await jsonFor(
                    playback,
                    `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
                ).catch(() => null))[0];
                const item = seed ? mapPlayerItem(seed) : null;
                const parentKey = item?.type === 'track' || item?.type === 'episode'
                    ? item.parentRatingKey
                    : ratingKey;
                const sourceKey = parentKey || ratingKey;
                const items = await collectPlayableQueue(uri, playback, sourceKey, item?.type === 'track' || item?.type === 'episode' ? null : seed);
                const idx = items.findIndex((row) => row.ratingKey === ratingKey);
                res.json({ items: idx >= 0 ? items.slice(idx) : items });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to build play queue.' });
        }
    });

    router.get('/hls/:ratingKey/master.m3u8', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            const hlsOpts = hlsQueryFromReq(req, ratingKey);
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const { body, lastDetail } = await loadHlsPlaylist({ uri, playback, ...hlsOpts });
                if (body) {
                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Cache-Control', 'no-store');
                    return res.send(body);
                }
                return res.status(502).json({
                    error: 'Plex refused to start transcode.',
                    detail: lastDetail,
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to start HLS stream.' });
        }
    });

    const disableStreamTimeouts = (req, res) => {
        try { req?.setTimeout?.(0); } catch { /* ignore */ }
        try { res?.setTimeout?.(0); } catch { /* ignore */ }
        try { req?.socket?.setTimeout?.(0); } catch { /* ignore */ }
    };

    const pipePlexBody = (plexRes, res, { asDownload = false, fileName = '', req = null } = {}) => {
        disableStreamTimeouts(req, res);
        const partial = plexRes.status === 206;
        res.status(asDownload ? (partial ? 206 : 200) : plexRes.status);
        res.setHeader('Cache-Control', 'no-store, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        if (asDownload) {
            const safeName = String(fileName || 'download')
                .replace(/[/\\?%*:|"<>]/g, '_')
                .replace(/"/g, '')
                .trim() || 'download';
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
            // Same-origin download iframe (global middleware defaults to DENY).
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            for (const name of ['content-length', 'content-range', 'accept-ranges']) {
                const value = plexRes.headers.get(name);
                if (value) res.setHeader(name, value);
            }
        } else {
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
                const value = plexRes.headers.get(name);
                if (value) res.setHeader(name, value);
            }
            if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
        }
        if (typeof res.flushHeaders === 'function' && plexRes.body) res.flushHeaders();
        if (plexRes.body && typeof Readable.fromWeb === 'function') {
            try {
                const stream = Readable.fromWeb(plexRes.body);
                stream.on('error', () => {
                    if (!res.writableEnded) res.destroy();
                });
                return stream.pipe(res);
            } catch {
                /* fall through to arrayBuffer when the mock has no web stream */
            }
        }
        return plexRes.arrayBuffer().then((buf) => res.send(Buffer.from(buf)));
    };

    router.get('/theme/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const data = await jsonFor(
                    playback,
                    `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
                );
                const meta = metadataList(data)[0];
                const themePath = pickPlayerThemePath(meta);
                if (!meta || !isPlayerThemePath(themePath)) {
                    return res.status(404).json({ error: 'No theme music.' });
                }
                const qIndex = themePath.indexOf('?');
                const pathname = qIndex >= 0 ? themePath.slice(0, qIndex) : themePath;
                const themeQuery = new URLSearchParams(qIndex >= 0 ? themePath.slice(qIndex + 1) : '');
                let plexRes = null;
                let lastDetail = '';
                for (const pair of streamPairsFor(playback)) {
                    const params = new URLSearchParams(themeQuery);
                    params.set('X-Plex-Token', pair.token);
                    const headers = { ...pair.headers };
                    if (req.headers.range) headers.Range = String(req.headers.range);
                    plexRes = await fetchImpl(`${uri}${pathname}?${params.toString()}`, { headers });
                    if (plexRes.ok || plexRes.status === 206) break;
                    lastDetail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    if (plexRes.status !== 401 && plexRes.status !== 403 && plexRes.status !== 404) break;
                }
                if (!plexRes || (!plexRes.ok && plexRes.status !== 206)) {
                    return res.status(404).json({ error: 'No theme music.', detail: lastDetail });
                }
                return pipePlexBody(plexRes, res, { req });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load theme music.' });
        }
    });

    router.get('/file/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            const asDownload = String(req.query.download || '') === '1';
            // Streaming Direct Play must work for TV ExoPlayer (members). Downloads stay admin-only.
            if (asDownload && !req.user?.isAdmin) {
                return res.status(403).json({ error: 'Admin required for downloads.' });
            }
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const mediaIndex = Math.max(0, Math.floor(Number(req.query.mediaIndex) || 0));
                const caps = playbackCapsFromRequest(req);
                let partId = asDownload ? '' : recalledDirectPlayPart(req, ratingKey, mediaIndex);
                let selected = null;
                let meta = null;
                let seedMeta = null;
                if (!partId) {
                    const data = await jsonFor(
                        playback,
                        `${uri}/library/metadata/${encodeURIComponent(ratingKey)}`,
                    );
                    seedMeta = metadataList(data)[0];
                    if (!seedMeta) return res.status(404).json({ error: 'Title not found.' });
                    meta = asDownload
                        ? (await resolvePlayableMeta(uri, playback, ratingKey, seedMeta)) || seedMeta
                        : seedMeta;
                    const resolvedIndex = pickMediaIndex(req.query.mediaIndex, meta);
                    selected = withSelectedMedia(meta, resolvedIndex);
                    partId = pickPlayerPartId(selected);
                    if (!asDownload && canHttpDirectPlay(selected, caps)) {
                        rememberDirectPlayPart(req, ratingKey, resolvedIndex, partId);
                    }
                }
                const redirectToHls = () => {
                    const token = accessTokenFromReq(req);
                    const src = withPlaybackAccessToken(
                        buildPlayerHlsFallbackSrc(ratingKey, req.query || {}),
                        token,
                    );
                    res.setHeader('Cache-Control', 'no-store');
                    return res.redirect(302, src);
                };
                if (!partId || (!asDownload && selected && !canHttpDirectPlay(selected, caps))) {
                    if (!asDownload) return redirectToHls();
                    return res.status(409).json({
                        error: 'No downloadable media file for this title.',
                    });
                }
                let plexRes = null;
                let lastDetail = '';
                for (const pair of streamPairsFor(playback)) {
                    const headers = { ...pair.headers };
                    if (req.headers.range) headers.Range = String(req.headers.range);
                    plexRes = await fetchImpl(
                        `${uri}/library/parts/${encodeURIComponent(partId)}/file?X-Plex-Token=${encodeURIComponent(pair.token)}`,
                        { headers },
                    );
                    if (plexRes.ok || plexRes.status === 206) break;
                    lastDetail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    if (plexRes.status !== 401 && plexRes.status !== 403 && plexRes.status !== 404) break;
                }
                if (!plexRes || (!plexRes.ok && plexRes.status !== 206)) {
                    if (!asDownload) {
                        directPlayPartCache.delete(directPlayPartKey(req, ratingKey, mediaIndex));
                        return redirectToHls();
                    }
                    return res.status(502).json({
                        error: 'Plex refused the download.',
                        detail: lastDetail,
                    });
                }
                const part = [].concat(selected?.Media?.[0]?.Part || selected?.Media?.Part || [])[0] || {};
                const container = String(part.container || selected?.Media?.[0]?.container || '').replace(/[^\w]+/g, '') || 'bin';
                const rawFile = String(part.file || meta?.title || seedMeta?.title || `plex-${ratingKey}`);
                const baseName = rawFile.split(/[/\\]/).pop() || `plex-${ratingKey}`;
                const fileName = /\.[a-z0-9]{2,5}$/i.test(baseName) ? baseName : `${baseName}.${container}`;
                return pipePlexBody(plexRes, res, { asDownload, fileName, req });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to start Direct Play.' });
        }
    });

    router.post('/timeline', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.body?.ratingKey || '').trim();
            const state = String(req.body?.state || '').trim().toLowerCase();
            if (!/^\d+$/.test(ratingKey) || !TIMELINE_STATES.has(state)) {
                return res.status(400).json({ error: 'Invalid timeline update.' });
            }
            const sessionId = isPlaySessionId(req.body?.sessionId) ? String(req.body.sessionId) : '';
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                let lastDetail = '';
                for (const pair of timelinePairsFor(playback)) {
                    const params = buildPlexTimelineParams({
                        ratingKey,
                        state,
                        timeMs: req.body?.timeMs,
                        durationMs: req.body?.durationMs,
                        sessionId,
                        audioStreamId: req.body?.audioStreamId,
                        subtitleStreamId: req.body?.subtitleStreamId,
                    });
                    addPlexIdentityParams(params, pair.headers, pair.token, { transcodeProfile: false });
                    const plexRes = await fetchImpl(`${uri}/:/timeline?${params.toString()}`, {
                        headers: {
                            ...pair.headers,
                            Accept: 'application/json, text/plain, */*',
                            'X-Plex-Session-Identifier': sessionId || pair.identity,
                        },
                    });
                    if (plexRes.ok) return res.status(204).end();
                    lastDetail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    if (plexRes.status !== 401 && plexRes.status !== 403) {
                        return res.status(502).json({ error: 'Plex refused timeline update.', detail: lastDetail });
                    }
                }
                res.status(204).end();
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to update timeline.' });
        }
    });

    router.post('/stop', requireAuth, requireMember, async (req, res) => {
        try {
            const sessionId = isPlaySessionId(req.body?.sessionId) ? String(req.body.sessionId) : '';
            if (!sessionId) return res.status(204).end();
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                for (const pair of streamPairsFor(playback)) {
                    const params = new URLSearchParams({ session: sessionId });
                    addPlexIdentityParams(params, pair.headers, pair.token, { transcodeProfile: false });
                    await plexFetch(
                        fetchImpl,
                        `${uri}/video/:/transcode/universal/stop?${params}`,
                        {
                            ...pair.headers,
                            'X-Plex-Session-Identifier': sessionId,
                        },
                        { timeoutMs: 5000 },
                    ).catch(() => null);
                }
                res.status(204).end();
            });
        } catch {
            res.status(204).end();
        }
    });

    router.get('/playlists', requireAuth, requireMember, async (req, res) => {
        try {
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const data = await plexJson(
                    fetchImpl,
                    `${uri}/playlists?playlistType=video&X-Plex-Container-Size=200&X-Plex-Token=${encodeURIComponent(playback.token)}`,
                    playback.metaHeaders,
                ).catch(() => null);
                res.json({
                    items: metadataList(data)
                        .filter((meta) => String(meta.playlistType || meta.type || 'video').toLowerCase() !== 'audio')
                        .map((meta) => mapPlayerPlaylist(meta, config))
                        .filter((row) => row.ratingKey),
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load playlists.' });
        }
    });

    router.get('/playlists/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid playlist.' });
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const [metaRes, itemsRes] = await Promise.all([
                    jsonFor(playback, `${uri}/playlists/${encodeURIComponent(ratingKey)}`),
                    jsonFor(
                        playback,
                        `${uri}/playlists/${encodeURIComponent(ratingKey)}/items?X-Plex-Container-Start=0&X-Plex-Container-Size=200`,
                    ).catch(() => null),
                ]);
                const meta = metadataList(metaRes)[0];
                if (!meta) return res.status(404).json({ error: 'Playlist not found.' });
                res.json({
                    item: mapPlayerPlaylist(meta, config),
                    children: metadataList(itemsRes || metaRes).map((row) => mapPlayerItem(row, config)),
                });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to load playlist.' });
        }
    });

    router.post('/playlists', requireAuth, requireMember, async (req, res) => {
        try {
            const title = String(req.body?.title || '').trim();
            const ratingKey = String(req.body?.ratingKey || '').trim();
            if (!title) return res.status(400).json({ error: 'Playlist name is required.' });
            if (ratingKey && !/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const machine = String(config.serverIdentifier || '').trim();
                if (!machine) return res.status(503).json({ error: 'Plex is not configured.' });
                const params = new URLSearchParams({
                    title,
                    type: 'video',
                    smart: '0',
                    'X-Plex-Token': playback.token,
                });
                if (ratingKey) params.set('uri', plexPlaylistUri(machine, ratingKey));
                const plexRes = await fetchImpl(`${uri}/playlists?${params.toString()}`, {
                    method: 'POST',
                    headers: playback.metaHeaders,
                });
                if (!plexRes.ok) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused to create the playlist.', detail });
                }
                const data = await plexRes.json().catch(() => null);
                const created = metadataList(data)[0];
                res.json({ item: created ? mapPlayerPlaylist(created, config) : { title, type: 'playlist' } });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to create playlist.' });
        }
    });

    router.post('/playlists/:ratingKey/items', requireAuth, requireMember, async (req, res) => {
        try {
            const playlistKey = String(req.params.ratingKey || '').trim();
            const ratingKey = String(req.body?.ratingKey || '').trim();
            if (!/^\d+$/.test(playlistKey) || !/^\d+$/.test(ratingKey)) {
                return res.status(400).json({ error: 'Invalid playlist item.' });
            }
            await withPlex(res, async ({ config, uri, token }) => {
                const playback = await playbackFor(req, token);
                const machine = String(config.serverIdentifier || '').trim();
                if (!machine) return res.status(503).json({ error: 'Plex is not configured.' });
                const params = new URLSearchParams({
                    uri: plexPlaylistUri(machine, ratingKey),
                    'X-Plex-Token': playback.token,
                });
                const plexRes = await fetchImpl(
                    `${uri}/playlists/${encodeURIComponent(playlistKey)}/items?${params.toString()}`,
                    { method: 'PUT', headers: playback.metaHeaders },
                );
                if (!plexRes.ok) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused to update the playlist.', detail });
                }
                res.status(204).end();
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to update playlist.' });
        }
    });

    const markWatched = (watched) => async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const action = watched ? 'scrobble' : 'unscrobble';
                const params = new URLSearchParams({
                    identifier: 'com.plexapp.plugins.library',
                    key: ratingKey,
                    'X-Plex-Token': playback.token,
                });
                const plexRes = await fetchImpl(`${uri}/:/${action}?${params.toString()}`, {
                    headers: playback.metaHeaders,
                });
                if (!plexRes.ok) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused the watched update.', detail });
                }
                res.status(204).end();
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to update watched status.' });
        }
    };

    router.post('/scrobble/:ratingKey', requireAuth, requireMember, markWatched(true));
    router.post('/unscrobble/:ratingKey', requireAuth, requireMember, markWatched(false));

    router.post('/item/:ratingKey/rate', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            const rating = Math.max(0, Math.min(10, Math.round(Number(req.body?.rating) || 0)));
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                const params = new URLSearchParams({
                    identifier: 'com.plexapp.plugins.library',
                    key: ratingKey,
                    rating: String(rating),
                    'X-Plex-Token': playback.token,
                });
                const plexRes = await fetchImpl(`${uri}/:/rate?${params.toString()}`, {
                    headers: playback.metaHeaders,
                });
                if (!plexRes.ok) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused the rating.', detail });
                }
                res.json({ ok: true, rating });
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to save rating.' });
        }
    });

    router.delete('/progress/:ratingKey', requireAuth, requireMember, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const playback = await playbackFor(req, token);
                // Official dismiss action (does not mark watched). Fall back to clearing progress.
                const dismissParams = new URLSearchParams({
                    ratingKey,
                    'X-Plex-Token': playback.token,
                });
                let plexRes = await fetchImpl(
                    `${uri}/actions/removeFromContinueWatching?${dismissParams.toString()}`,
                    { method: 'PUT', headers: playback.metaHeaders },
                );
                if (!plexRes.ok && plexRes.status !== 404) {
                    await plexRes.text().catch(() => '');
                    const progressParams = new URLSearchParams({
                        identifier: 'com.plexapp.plugins.library',
                        key: ratingKey,
                        'X-Plex-Token': playback.token,
                    });
                    plexRes = await fetchImpl(`${uri}/:/progress?${progressParams.toString()}`, {
                        method: 'DELETE',
                        headers: playback.metaHeaders,
                    });
                }
                if (!plexRes.ok && plexRes.status !== 404) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused to remove from Continue Watching.', detail });
                }
                await plexRes.text().catch(() => '');
                clearHomeCaches(req);
                res.status(204).end();
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to remove from Continue Watching.' });
        }
    });

    router.delete('/item/:ratingKey', requireAuth, adminOnly, async (req, res) => {
        try {
            const ratingKey = String(req.params.ratingKey || '').trim();
            if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'Invalid title.' });
            await withPlex(res, async ({ uri, token }) => {
                const params = new URLSearchParams({ 'X-Plex-Token': token });
                const plexRes = await fetchImpl(
                    `${uri}/library/metadata/${encodeURIComponent(ratingKey)}?${params.toString()}`,
                    {
                        method: 'DELETE',
                        headers: plexClientHeaders(token),
                    },
                );
                if (!plexRes.ok && plexRes.status !== 404) {
                    const detail = String(await plexRes.text().catch(() => '')).slice(0, 200);
                    return res.status(502).json({ error: 'Plex refused to delete the title.', detail });
                }
                clearHomeCaches(req);
                libraryHomeCache.clear();
                res.status(204).end();
            });
        } catch (error) {
            res.status(500).json({ error: error.message || 'Failed to delete title.' });
        }
    });

    router.get('/proxy', requireAuth, requireMember, async (req, res) => {
        try {
            const config = await loadPortalConfig();
            if (String(config?.mediaServerType || 'plex').toLowerCase() !== 'plex') {
                return res.status(400).end();
            }
            const uri = await getPlexConnectionUri(config);
            if (!uri) return res.status(503).end();
            const raw = String(req.query.u || '');
            if (!raw) return res.status(400).end();
            let target;
            try {
                target = rewritePlexUrlToOrigin(decodeURIComponent(raw), uri);
            } catch {
                return res.status(400).end();
            }
            if (!isAllowedPlexProxyUrl(target, uri)) return res.status(403).end();
            const playback = await playbackFor(req, config.plexToken);
            let plexRes = null;
            for (const pair of streamPairsFor(playback)) {
                const headers = { ...pair.headers };
                if (req.headers.range) headers.Range = String(req.headers.range);
                plexRes = await fetchImpl(target, { headers });
                if (plexRes.ok || plexRes.status === 206) break;
                if (plexRes.status !== 401 && plexRes.status !== 403 && plexRes.status !== 404) break;
            }
            if (!plexRes) return res.status(502).json({ error: 'Stream proxy failed.' });
            disableStreamTimeouts(req, res);
            const contentType = plexRes.headers.get('content-type') || '';
            res.status(plexRes.status);
            res.setHeader('Cache-Control', 'no-store, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            if (/mpegurl|x-mpegURL|vnd\.apple\.mpegurl/i.test(contentType) || target.includes('.m3u8')) {
                const body = await plexRes.text();
                const accessToken = String(
                    req.query?.access_token
                    || String(req.get?.('authorization') || '').replace(/^Bearer\s+/i, '')
                    || req.cookies?.session
                    || ''
                ).trim();
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                return res.send(rewritePlaylistUrls(
                    body,
                    uri,
                    '/api/media-player/proxy?u=',
                    plexRes.url || target,
                    accessToken,
                ));
            }
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
                const value = plexRes.headers.get(name);
                if (value) res.setHeader(name, value);
            }
            if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
            if (typeof res.flushHeaders === 'function' && plexRes.body) res.flushHeaders();
            try {
                if (plexRes.body && typeof Readable.fromWeb === 'function') {
                    const stream = Readable.fromWeb(plexRes.body);
                    stream.on('error', () => {
                        if (!res.writableEnded) res.destroy();
                    });
                    return stream.pipe(res);
                }
            } catch {
                /* fall through to buffered copy */
            }
            const buffer = Buffer.from(await plexRes.arrayBuffer());
            res.send(buffer);
        } catch (error) {
            res.status(502).json({ error: error.message || 'Stream proxy failed.' });
        }
    });

    return router;
};
