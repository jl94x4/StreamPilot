import { apiErrorMessage, apiFetch, PORTAL_CSRF_HEADER, PORTAL_CSRF_VALUE } from '../shared/api';
import { portalUrl } from '../shared/basePath';
import { DISCOVER_NETWORKS, DISCOVER_STUDIOS } from '../discovery/discoverConstants';
import { pickTmdbPersonMatch, personCreditYear, splitPersonCredits } from '../discovery/personCredits';
import { preferStudioBrowseLogos } from '../../lib/media-player/studioBrowse.js';
import {
    NETWORK_BROWSE_PRIORITY,
    STUDIO_BROWSE_PRIORITY,
    sortStudioBrowseCards,
    studioBrowseDedupeKey,
} from './studioBrowsePlate.js';
import { PLAYER_API_ROOT } from './paths';
import {
    readPlayerItemCache,
    writePlayerItemCache,
    writePlayerHomeCache,
    writeHeroSlidesCache,
    writePlayerLibrariesCache,
    playerHomeHasRows,
    playerHomeNeedsFull,
} from './playerMemory';
import { applyRememberedProgress, browserPlaybackCaps, noteItemWatched, plexBackdropPreviewUrl, plexBackdropUrl, prefetchPlayerImages, withWatchedProgress } from './playerUtils';
import { matchDiscoverCompanyByName } from './studioLogo.js';
import type {
    PlayerHome,
    PlayerItem,
    PlayerItemPage,
    PlayerLibraryFilters,
    PlayerLibraryHome,
    PlayerLibraryPage,
    PlayerLibraryStudios,
    PlayerPlaySession,
    PlayerPersonBundle,
    PlayerPersonCreditRow,
    PlayerPersonPage,
    PlayerPersonProfile,
    PlayerProfile,
    PlayerSection,
    PlayerStudioBrowseCard,
} from './types';

const prefetchItemBackdrop = (item?: { art?: string | null } | null) => {
    const art = item?.art;
    if (!art) return;
    prefetchPlayerImages([plexBackdropPreviewUrl(art), plexBackdropUrl(art)], 2);
};

const prefetchHeroBackdrops = (items?: Array<{ art?: string | null } | null>) => {
    const list = (items || []).filter((item) => item?.art).slice(0, 3);
    const urls: string[] = [];
    list.forEach((item, index) => {
        urls.push(plexBackdropPreviewUrl(item.art));
        if (index === 0) urls.push(plexBackdropUrl(item.art));
    });
    prefetchPlayerImages(urls, 4);
};

let meInflight: Promise<PlayerProfile> | null = null;
let meCache: PlayerProfile | null = null;

export const fetchMediaPlayerMe = () => {
    if (meCache) return Promise.resolve(meCache);
    if (meInflight) return meInflight;
    meInflight = (apiFetch(`${PLAYER_API_ROOT}/me`) as Promise<PlayerProfile>)
        .then((data) => {
            meCache = data;
            return data;
        })
        .finally(() => {
            meInflight = null;
        });
    return meInflight;
};

let homeInflight: Promise<PlayerHome> | null = null;
let homeFullInflight: Promise<PlayerHome> | null = null;

export const fetchMediaPlayerHome = () => {
    if (homeInflight) return homeInflight;
    homeInflight = (apiFetch(`${PLAYER_API_ROOT}/home`) as Promise<PlayerHome>)
        .then((data) => {
            if (!data?.partial) writePlayerHomeCache(data);
            return data;
        })
        .finally(() => {
            homeInflight = null;
        });
    return homeInflight;
};

/** Second pass for direct mode: Plex hubs, after the fast rows are already on screen. */
export const fetchMediaPlayerHomeFull = () => {
    if (homeFullInflight) return homeFullInflight;
    homeFullInflight = (apiFetch(`${PLAYER_API_ROOT}/home?full=1`) as Promise<PlayerHome>)
        .finally(() => {
            homeFullInflight = null;
        });
    return homeFullInflight;
};

/** Kick off nav + home during auth/boot so the first paint rarely waits on cold fetches. */
export const prefetchMediaPlayerHome = () => {
    void fetchMediaPlayerLibraries().catch(() => undefined);
    void fetchMediaPlayerMe().catch(() => undefined);
    // Always warm/refresh Home in the background; UI paints from cache when present.
    void fetchMediaPlayerHome()
        .then((data) => {
            if (data && playerHomeHasRows(data)) writePlayerHomeCache(data);
            if (data && playerHomeNeedsFull(data)) {
                void fetchMediaPlayerHomeFull()
                    .then((full) => {
                        if (full && playerHomeHasRows(full)) writePlayerHomeCache(full);
                    })
                    .catch(() => undefined);
            }
        })
        .catch(() => undefined);
    void fetchMediaPlayerHomeHero()
        .then((data) => {
            const items = data?.enabled && Array.isArray(data.items) ? data.items : [];
            if (items.length) {
                writeHeroSlidesCache(items);
                prefetchHeroBackdrops(items);
            }
        })
        .catch(() => undefined);
};

export type MediaPlayerHomeHeroPayload = {
    enabled: boolean;
    mode?: string;
    effectiveMode?: string;
    refreshedAt?: number | null;
    expiresAt?: number | null;
    items: Array<{
        ratingKey: string;
        title: string;
        type: string;
        year?: number | null;
        summary?: string;
        thumb?: string | null;
        art?: string | null;
        logo?: string | null;
        backdropUrl?: string | null;
        posterUrl?: string | null;
        tmdbId?: number | null;
        canPlay?: boolean;
    }>;
    reason?: string;
};

export const fetchMediaPlayerHomeHero = () => (
    (apiFetch(`${PLAYER_API_ROOT}/home-hero`) as Promise<MediaPlayerHomeHeroPayload>)
        .then((data) => {
            if (data?.enabled && Array.isArray(data.items)) prefetchHeroBackdrops(data.items);
            return data;
        })
);

export const fetchMediaPlayerHomeHeroRefresh = () => (
    apiFetch(`${PLAYER_API_ROOT}/home-hero?refresh=1`) as Promise<MediaPlayerHomeHeroPayload>
);

export const fetchMediaPlayerHomeHeroConfig = () => (
    apiFetch(`${PLAYER_API_ROOT}/home-hero-config`) as Promise<{
        mode: string;
        seasonalInWindowOnly: boolean;
        continueWatchingSeasonPoster?: boolean;
    }>
);

export const saveMediaPlayerHomeHeroConfig = (payload: {
    mode: string;
    seasonalInWindowOnly: boolean;
    continueWatchingSeasonPoster?: boolean;
}) => (
    apiFetch(`${PLAYER_API_ROOT}/home-hero-config`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    }) as Promise<{
        mode: string;
        seasonalInWindowOnly: boolean;
        continueWatchingSeasonPoster?: boolean;
        saved?: boolean;
    }>
);

let librariesSerial = 0;

const delayMs = (ms: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
});

/** Nav library list — retries briefly so a cold PMS does not leave the side rail empty. */
export const fetchMediaPlayerLibraries = async () => {
    const serial = ++librariesSerial;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        if (serial !== librariesSerial) {
            return { libraries: [] as PlayerSection[], stale: true };
        }
        try {
            const data = await (apiFetch(`${PLAYER_API_ROOT}/libraries`) as Promise<{ libraries: PlayerSection[] }>);
            if (serial !== librariesSerial) return { ...data, stale: true };
            const libraries = Array.isArray(data?.libraries) ? data.libraries : [];
            if (libraries.length) writePlayerLibrariesCache(libraries);
            return { ...data, libraries };
        } catch (error) {
            lastError = error;
            if (attempt < 2 && serial === librariesSerial) {
                await delayMs(450 * (attempt + 1));
                continue;
            }
        }
    }
    throw lastError || new Error('Failed to load libraries');
};

export const fetchMediaPlayerLibrary = (
    sectionKey: string,
    start = 0,
    size = 50,
    opts: {
        sort?: string;
        genre?: string;
        decade?: string;
        year?: string;
        contentRating?: string;
        resolution?: string;
        studio?: string;
        network?: string;
        country?: string;
        collection?: string;
        audioLanguage?: string;
        subtitleLanguage?: string;
        actor?: string;
        director?: string;
        writer?: string;
        producer?: string;
        label?: string;
        unwatched?: boolean;
        inProgress?: boolean;
        hdr?: boolean;
        duplicate?: boolean;
        letter?: string;
    } = {},
) => {
    const qs = new URLSearchParams({
        start: String(start),
        size: String(size),
    });
    if (opts.sort) qs.set('sort', opts.sort);
    if (opts.genre) qs.set('genre', opts.genre);
    if (opts.decade) qs.set('decade', opts.decade);
    if (opts.year) qs.set('year', opts.year);
    if (opts.contentRating) qs.set('contentRating', opts.contentRating);
    if (opts.resolution) qs.set('resolution', opts.resolution);
    if (opts.studio) qs.set('studio', opts.studio);
    if (opts.network) qs.set('network', opts.network);
    if (opts.country) qs.set('country', opts.country);
    if (opts.collection) qs.set('collection', opts.collection);
    if (opts.audioLanguage) qs.set('audioLanguage', opts.audioLanguage);
    if (opts.subtitleLanguage) qs.set('subtitleLanguage', opts.subtitleLanguage);
    if (opts.actor) qs.set('actor', opts.actor);
    if (opts.director) qs.set('director', opts.director);
    if (opts.writer) qs.set('writer', opts.writer);
    if (opts.producer) qs.set('producer', opts.producer);
    if (opts.label) qs.set('label', opts.label);
    if (opts.inProgress) qs.set('inProgress', '1');
    else if (opts.unwatched) qs.set('unwatched', '1');
    if (opts.hdr) qs.set('hdr', '1');
    if (opts.duplicate) qs.set('duplicate', '1');
    if (opts.letter) qs.set('letter', opts.letter);
    return apiFetch(`${PLAYER_API_ROOT}/libraries/${encodeURIComponent(sectionKey)}?${qs}`) as Promise<PlayerLibraryPage>;
};

export const fetchMediaPlayerLibraryHome = (sectionKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/libraries/${encodeURIComponent(sectionKey)}/home`) as Promise<PlayerLibraryHome>
);

export const fetchMediaPlayerLibraryFilters = (sectionKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/libraries/${encodeURIComponent(sectionKey)}/filters`) as Promise<PlayerLibraryFilters>
);

export const fetchMediaPlayerCollections = (sectionKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/libraries/${encodeURIComponent(sectionKey)}/collections`) as Promise<{ title: string; items: PlayerItem[] }>
);

export const fetchMediaPlayerLibraryStudios = async (sectionKey: string) => {
    const data = await apiFetch(
        `${PLAYER_API_ROOT}/libraries/${encodeURIComponent(sectionKey)}/studios`,
    ) as PlayerLibraryStudios;
    const attachLogo = (
        cards: PlayerStudioBrowseCard[] | undefined,
        catalog: Array<{ name: string; logoPath: string }>,
        priority: string[],
    ) => sortStudioBrowseCards(
        preferStudioBrowseLogos(
            (Array.isArray(cards) ? cards : []).map((card) => {
                const hit = matchDiscoverCompanyByName(card.title, catalog);
                const logoPath = hit?.logoPath ? String(hit.logoPath) : (card.logoPath || '');
                return {
                    ...card,
                    // Prefer the catalog display name when we matched a brand logo.
                    title: hit?.name ? String(hit.name) : card.title,
                    logoPath: logoPath || undefined,
                };
            }),
            undefined,
            studioBrowseDedupeKey,
        ),
        priority,
    );
    return {
        networks: attachLogo(data?.networks, DISCOVER_NETWORKS, NETWORK_BROWSE_PRIORITY),
        studios: attachLogo(data?.studios, DISCOVER_STUDIOS, STUDIO_BROWSE_PRIORITY),
    } as PlayerLibraryStudios;
};

export const fetchMediaPlayerCollection = (ratingKey: string, sectionKey?: string) => {
    const qs = sectionKey ? `?section=${encodeURIComponent(sectionKey)}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/collection/${encodeURIComponent(ratingKey)}${qs}`) as Promise<PlayerItemPage>;
};

export const fetchMediaPlayerHub = (path: string, opts: { title?: string; identifier?: string } = {}) => {
    const qs = new URLSearchParams({ path });
    if (opts.title) qs.set('title', opts.title);
    if (opts.identifier) qs.set('identifier', opts.identifier);
    return apiFetch(`${PLAYER_API_ROOT}/hub?${qs.toString()}`) as Promise<{ title: string; items: PlayerItem[] }>;
};

let playlistsInflight: Promise<{ items: PlayerItem[] }> | null = null;
let playlistsCache: { at: number; items: PlayerItem[] } | null = null;
const PLAYLISTS_CACHE_TTL_MS = 60_000;

export const fetchMediaPlayerPlaylists = (opts: { force?: boolean } = {}) => {
    if (!opts.force && playlistsCache && Date.now() - playlistsCache.at < PLAYLISTS_CACHE_TTL_MS) {
        return Promise.resolve({ items: playlistsCache.items });
    }
    if (!opts.force && playlistsInflight) return playlistsInflight;
    playlistsInflight = apiFetch(`${PLAYER_API_ROOT}/playlists`)
        .then((data: { items?: PlayerItem[] }) => {
            const items = Array.isArray(data?.items) ? data.items : [];
            playlistsCache = { at: Date.now(), items };
            return { items };
        })
        .finally(() => {
            playlistsInflight = null;
        });
    return playlistsInflight;
};

export const fetchMediaPlayerPlaylist = (ratingKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/playlists/${encodeURIComponent(ratingKey)}`) as Promise<PlayerItemPage>
);

export const createMediaPlayerPlaylist = async (title: string, ratingKey?: string) => {
    const created = await apiFetch(`${PLAYER_API_ROOT}/playlists`, {
        method: 'POST',
        body: JSON.stringify({ title, ratingKey }),
    }) as { item: PlayerItem };
    playlistsCache = null;
    return created;
};

export const addMediaPlayerPlaylistItem = (playlistKey: string, ratingKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/playlists/${encodeURIComponent(playlistKey)}/items`, {
        method: 'POST',
        body: JSON.stringify({ ratingKey }),
    })
);

export const setMediaPlayerWatched = async (
    ratingKey: string,
    watched: boolean,
    item?: PlayerItem | null,
    opts?: { skipNote?: boolean },
) => {
    await apiFetch(`${PLAYER_API_ROOT}/${watched ? 'scrobble' : 'unscrobble'}/${encodeURIComponent(ratingKey)}`, {
        method: 'POST',
    });
    if (opts?.skipNote) return;
    let continueWith: PlayerItem | null = null;
    let restoreContinue: PlayerItem | null = null;
    const advanceContinue = watched && (item?.type === 'episode' || item?.type === 'show' || item?.type === 'season');
    if (watched && item?.type === 'episode') {
        try {
            const data = await fetchMediaPlayerNext(ratingKey, item?.serverId);
            continueWith = data?.item?.type === 'episode' && !data.item.watched ? data.item : null;
        } catch {
            continueWith = null;
        }
    }
    if (watched && (item?.type === 'show' || item?.type === 'season')) {
        try {
            const page = await fetchMediaPlayerItem(ratingKey, { core: true, serverId: item.serverId || null });
            continueWith = page.onDeck && !page.onDeck.watched ? page.onDeck : null;
        } catch {
            continueWith = null;
        }
    }
    if (!watched && item?.type === 'episode') {
        restoreContinue = { ...item, watched: false, viewOffsetMs: 0 };
    }
    if (!watched && (item?.type === 'show' || item?.type === 'season')) {
        try {
            const page = await fetchMediaPlayerItem(ratingKey, { core: true, serverId: item.serverId || null });
            restoreContinue = page.onDeck || null;
        } catch {
            restoreContinue = null;
        }
    }
    noteItemWatched(ratingKey, watched, continueWith, advanceContinue, restoreContinue);
};

/** Scrobble every episode in a season, then the season itself so leaf counts match. */
export const setSeasonEpisodesWatched = async (seasonKey: string, watched: boolean, serverId?: string | null) => {
    const page = await fetchMediaPlayerItem(seasonKey, { core: true, serverId: serverId || null });
    const episodeKeys = (page.children || [])
        .filter((row) => row.type === 'episode' && row.ratingKey)
        .map((row) => row.ratingKey);
    const keys = [...new Set([...episodeKeys, seasonKey])];
    const queue = keys.slice();
    let failed = false;
    const workers = Array.from({ length: Math.min(4, Math.max(queue.length, 1)) }, async () => {
        while (queue.length && !failed) {
            const key = queue.shift();
            if (!key) return;
            try {
                await setMediaPlayerWatched(key, watched, undefined, { skipNote: true });
            } catch {
                failed = true;
            }
        }
    });
    await Promise.all(workers);
    if (failed) throw new Error('Could not update every episode.');
    let restoreContinue: PlayerItem | null = null;
    let continueWith: PlayerItem | null = null;
    try {
        const fresh = await fetchMediaPlayerItem(seasonKey, { core: true, serverId: serverId || null });
        if (watched) continueWith = fresh.onDeck && !fresh.onDeck.watched ? fresh.onDeck : null;
        else restoreContinue = fresh.onDeck || null;
    } catch {
        restoreContinue = page.onDeck || null;
    }
    noteItemWatched(seasonKey, watched, continueWith, watched && !!continueWith, restoreContinue);
    return episodeKeys.length;
};

export const removeMediaPlayerProgress = (ratingKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/progress/${encodeURIComponent(ratingKey)}`, {
        method: 'DELETE',
    })
);

export const deleteMediaPlayerItem = (ratingKey: string) => (
    apiFetch(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}`, {
        method: 'DELETE',
    })
);

export const mediaPlayerDownloadUrl = (ratingKey: string, mediaIndex = 0) => {
    const qs = new URLSearchParams({ download: '1' });
    if (mediaIndex) qs.set('mediaIndex', String(mediaIndex));
    return `${PLAYER_API_ROOT}/file/${encodeURIComponent(ratingKey)}?${qs}`;
};

/** Absolute PMS/portal part URL + headers for phone in-app offline downloads. */
export const resolveMediaPlayerDownloadSource = (
    ratingKey: string,
    opts: { mediaIndex?: number; serverId?: string | null } = {},
) => {
    const params = new URLSearchParams();
    if (opts.mediaIndex != null) params.set('mediaIndex', String(opts.mediaIndex));
    if (opts.serverId) params.set('server', opts.serverId);
    const qs = params.toString() ? `?${params}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/download-source/${encodeURIComponent(ratingKey)}${qs}`) as Promise<{
        url: string;
        headers: Record<string, string>;
        fileName: string;
        bytes: number;
        ratingKey: string;
        title: string;
        type: string;
        thumb?: string | null;
        serverId?: string;
        plexGuid?: string | null;
    }>;
};

/** Trigger a browser file download without navigating away (large media-safe). */
export const startMediaPlayerDownload = async (ratingKey: string, mediaIndex = 0) => {
    const href = portalUrl(mediaPlayerDownloadUrl(ratingKey, mediaIndex));
    const probe = await fetch(href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
            Accept: '*/*',
            Range: 'bytes=0-0',
            [PORTAL_CSRF_HEADER]: PORTAL_CSRF_VALUE,
        },
    });
    if (!probe.ok && probe.status !== 206) {
        const text = await probe.text().catch(() => '');
        throw new Error(apiErrorMessage(probe.status, text));
    }
    try {
        if (probe.body && typeof probe.body.cancel === 'function') await probe.body.cancel();
    } catch {
        /* ignore */
    }

    // Prefer a real navigation download. Keep the element briefly — removing it
    // immediately can cancel the browser's download in some engines.
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
        try { anchor.remove(); } catch { /* ignore */ }
    }, 2000);
};

const withServerQuery = (path: string, serverId?: string | null) => {
    const id = String(serverId || '').trim();
    if (!id) return path;
    return `${path}${path.includes('?') ? '&' : '?'}server=${encodeURIComponent(id)}`;
};

export const fetchMediaPlayerNext = (ratingKey: string, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/next/${encodeURIComponent(ratingKey)}`, serverId)) as Promise<{ item: PlayerItem | null }>
);

export const fetchMediaPlayerNeighbors = (ratingKey: string, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/neighbors/${encodeURIComponent(ratingKey)}`, serverId)) as Promise<{
        previous: PlayerItem | null;
        next: PlayerItem | null;
    }>
);

const itemInflight = new Map<string, Promise<PlayerItemPage>>();

export const fetchMediaPlayerItem = (ratingKey: string, opts: { core?: boolean; serverId?: string | null } = {}) => {
    const key = `${opts.serverId || ''}|${ratingKey}|${opts.core ? '1' : '0'}`;
    const existing = itemInflight.get(key);
    if (existing) return existing;
    const params = new URLSearchParams();
    if (opts.core) params.set('core', '1');
    if (opts.serverId) params.set('server', opts.serverId);
    const qs = params.toString() ? `?${params}` : '';
    const promise = (apiFetch(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}${qs}`) as Promise<PlayerItemPage>)
        .then((data) => {
            const prev = readPlayerItemCache(ratingKey);
            const children = (data.children || []).map((row) => applyRememberedProgress(row));
            const item = applyRememberedProgress(withWatchedProgress(data.item, children));
            const page = {
                ...data,
                item,
                children,
            };
            writePlayerItemCache(ratingKey, {
                item,
                children,
                extras: data.extras?.length ? data.extras : (prev?.extras || []),
                related: data.related?.length ? data.related : (prev?.related || []),
                onDeck: data.onDeck !== undefined ? data.onDeck : (prev?.onDeck ?? null),
            });
            prefetchItemBackdrop(item);
            return page;
        })
        .finally(() => {
            itemInflight.delete(key);
        });
    itemInflight.set(key, promise);
    return promise;
};

/** Warm overview cache while a poster is focused (TV leanback). */
const prefetchQueue: string[] = [];
let prefetchRunning = 0;
const PREFETCH_CONCURRENCY = 2;

const runPrefetchQueue = () => {
    while (prefetchRunning < PREFETCH_CONCURRENCY && prefetchQueue.length) {
        const key = prefetchQueue.shift();
        if (!key) break;
        if (itemInflight.has(`${key}|1`) || itemInflight.has(`${key}|0`)) continue;
        const cached = readPlayerItemCache(key);
        if (cached?.item) {
            prefetchItemBackdrop(cached.item);
            continue;
        }
        prefetchRunning += 1;
        void fetchMediaPlayerItem(key, { core: true })
            .catch(() => undefined)
            .finally(() => {
                prefetchRunning = Math.max(0, prefetchRunning - 1);
                runPrefetchQueue();
            });
    }
};

export const prefetchMediaPlayerItem = (ratingKey: string) => {
    const key = String(ratingKey || '').trim();
    if (!key || !/^\d+$/.test(key)) return;
    const cached = readPlayerItemCache(key);
    if (cached?.item) {
        prefetchItemBackdrop(cached.item);
        return;
    }
    if (itemInflight.has(`${key}|1`) || itemInflight.has(`${key}|0`)) return;
    if (prefetchQueue.includes(key)) return;
    prefetchQueue.push(key);
    // Prefer the latest focus: keep queue short.
    while (prefetchQueue.length > 4) prefetchQueue.shift();
    runPrefetchQueue();
};

export const fetchMediaPlayerItemMore = (ratingKey: string, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}/more`, serverId)) as Promise<{
        extras: PlayerItemPage['extras'];
        related: PlayerItemPage['related'];
        onDeck?: PlayerItemPage['onDeck'];
    }>
);

export const fetchMediaPlayerPerson = (actorId: string, name = '') => {
    const qs = new URLSearchParams();
    if (name) qs.set('name', name);
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/person/${encodeURIComponent(actorId)}${suffix}`) as Promise<PlayerPersonPage>;
};

export const fetchMediaPlayerStudio = (
    studioKey: string,
    opts: { name?: string; sectionKey?: string; mediaType?: 'movie' | 'show' } = {},
) => {
    const qs = new URLSearchParams();
    if (opts.name) qs.set('name', opts.name);
    if (opts.sectionKey) qs.set('section', opts.sectionKey);
    if (opts.mediaType) qs.set('type', opts.mediaType);
    const suffix = qs.toString() ? `?${qs}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/studio/${encodeURIComponent(studioKey)}${suffix}`) as Promise<{
        studio: { key: string; name: string };
        items: PlayerItem[];
    }>;
};

const searchDiscoveryPeople = async (query: string) => {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const fromSearch = await apiFetch(`/api/discovery/search?query=${encodeURIComponent(q)}`).catch(() => null);
    const searchRows = Array.isArray(fromSearch?.results) ? fromSearch.results : [];
    if (pickTmdbPersonMatch(searchRows, { name: q })) return searchRows;
    const proxy = await apiFetch(`/api/discovery/proxy/search?query=${encodeURIComponent(q)}`).catch(() => null);
    const proxyRows = Array.isArray(proxy?.results) ? proxy.results : [];
    return proxyRows.length ? proxyRows : searchRows;
};

export const fetchPlayerPersonBundle = async (
    actorId: string,
    name = '',
    thumb?: string | null,
): Promise<PlayerPersonBundle> => {
    const queryName = String(name || '').trim();
    const data = await fetchMediaPlayerPerson(actorId, queryName);
    const items = data.items || [];
    const resolvedName = String(data.person?.name || queryName).trim();
    const fold = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const serverKeys = new Map(items.map((row) => [fold(row.title), row]));

    const mapCredits = (rows: any[], department: 'cast' | 'crew'): PlayerPersonCreditRow[] => (
        (Array.isArray(rows) ? rows : []).map((row) => {
            const title = String(row?.title || row?.name || '').trim();
            const key = fold(title);
            const onServer = serverKeys.get(key);
            const mediaType = String(row?.mediaType || row?.media_type || '').toLowerCase() === 'tv' ? 'tv' : 'movie';
            const id = String(row?.tmdbId || row?.id || `${mediaType}:${title}`);
            return {
                id,
                title,
                year: personCreditYear(row) || null,
                mediaType,
                role: String(row?.character || row?.job || '').trim() || null,
                department,
                posterPath: row?.posterPath || row?.poster_path || null,
                onServer: Boolean(onServer),
                ratingKey: onServer?.ratingKey || null,
            };
        }).filter((row) => row.title)
    );

    const withFilmography = async (profile: PlayerPersonProfile | null, tmdbId?: number) => {
        let filmography: PlayerPersonCreditRow[] = [];
        if (Number.isFinite(tmdbId) && (tmdbId as number) > 0) {
            const credits = await apiFetch(`/api/discovery/proxy/person/${tmdbId}/combined_credits`).catch(() => null);
            const { cast, crew } = splitPersonCredits(credits || {});
            filmography = [...mapCredits(cast, 'cast'), ...mapCredits(crew, 'crew')]
                .sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')) || a.title.localeCompare(b.title))
                .slice(0, 120);
        }
        if (!filmography.length && items.length) {
            filmography = items.map((row) => ({
                id: row.ratingKey,
                title: row.title,
                year: row.year != null ? String(row.year) : null,
                mediaType: row.type === 'show' ? 'tv' : 'movie',
                role: null,
                department: 'cast',
                posterPath: null,
                onServer: true,
                ratingKey: row.ratingKey,
            }));
        }
        return {
            person: { name: resolvedName, thumb: thumb || data.person?.thumb || null },
            items,
            profile,
            filmography,
        };
    };

    if (data.profile?.name || data.profile?.biography || data.profile?.birthday || data.profile?.placeOfBirth) {
        let rows = await searchDiscoveryPeople(resolvedName || queryName);
        const match = pickTmdbPersonMatch(rows, {
            name: resolvedName,
            knownTitles: items.map((row) => row.title),
        });
        return withFilmography(data.profile || null, Number(match?.id));
    }
    let rows = await searchDiscoveryPeople(queryName);
    if (resolvedName && resolvedName.toLowerCase() !== queryName.toLowerCase()) {
        const extra = await searchDiscoveryPeople(resolvedName);
        if (extra.length) rows = extra;
    }
    const match = pickTmdbPersonMatch(rows, {
        name: resolvedName,
        knownTitles: items.map((row) => row.title),
    });
    const tmdbId = Number(match?.id);
    const profile = Number.isFinite(tmdbId) && tmdbId > 0
        ? await apiFetch(`/api/discovery/proxy/person/${tmdbId}`).catch(() => null) as PlayerPersonProfile | null
        : null;
    return withFilmography(profile, tmdbId);
};

export const searchMediaPlayer = (query: string) => (
    apiFetch(`${PLAYER_API_ROOT}/search?q=${encodeURIComponent(query)}`) as Promise<{ results: PlayerItemPage['item'][] }>
);

/** Resolve a local library copy for Watch Together join (guid / tmdb / title match). */
export const resolveWatchTogetherLocalItem = (opts: {
    guids?: string[] | null;
    tmdbId?: number | null;
    year?: number | null;
    title?: string | null;
    mediaType?: string | null;
}) => {
    const params = new URLSearchParams();
    const guids = Array.isArray(opts.guids) ? opts.guids.filter(Boolean) : [];
    if (guids.length) params.set('guids', guids.join(','));
    if (opts.tmdbId != null && Number(opts.tmdbId) > 0) params.set('tmdbId', String(Math.floor(Number(opts.tmdbId))));
    if (opts.year != null && Number(opts.year) > 0) params.set('year', String(Math.floor(Number(opts.year))));
    if (opts.title) params.set('title', String(opts.title));
    if (opts.mediaType) params.set('type', String(opts.mediaType));
    return apiFetch(`${PLAYER_API_ROOT}/watch-together/resolve?${params}`) as Promise<{ item: PlayerItem | null }>;
};

export const fetchMediaPlayerServers = () => (
    apiFetch(`${PLAYER_API_ROOT}/servers`) as Promise<{ servers: Array<{ id: string; name: string; enabled: boolean }> }>
)

/** Reachability of each enabled PMS — drives orange offline marks on library rows. */
export const fetchMediaPlayerServerStatus = () => (
    apiFetch(`${PLAYER_API_ROOT}/servers/status`) as Promise<{
        servers: Array<{ id: string; name?: string; online: boolean }>;
    }>
);

export const saveMediaPlayerServers = (enabledIds: string[]) => (
    apiFetch(`${PLAYER_API_ROOT}/servers`, {
        method: 'POST',
        body: JSON.stringify({ enabledIds }),
    }) as Promise<{ servers: Array<{ id: string; name: string; enabled: boolean }> }>
);

export const fetchMediaPlayerSettings = () => (
    apiFetch(`${PLAYER_API_ROOT}/settings`) as Promise<Record<string, unknown>>
);

export const saveMediaPlayerSettings = (settings: Record<string, unknown>) => (
    apiFetch(`${PLAYER_API_ROOT}/settings`, {
        method: 'PUT',
        body: JSON.stringify(settings),
    }) as Promise<Record<string, unknown>>
);

let watchlistCache: Promise<{ items: PlayerItem[] }> | null = null;

export const fetchMediaPlayerSubtitleSearch = (ratingKey: string, opts: { language?: string; serverId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (opts.language) params.set('language', opts.language);
    if (opts.serverId) params.set('server', opts.serverId);
    const qs = params.toString() ? `?${params}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}/subtitles${qs}`) as Promise<{
        items: Array<{ id: string; label: string; url: string }>;
    }>;
};

/** Probe whether PMS has voice-activity data for subtitle auto-sync. */
export const fetchMediaPlayerVoiceActivity = (ratingKey: string, opts: { serverId?: string | null } = {}) => {
    const params = new URLSearchParams();
    if (opts.serverId) params.set('server', opts.serverId);
    const qs = params.toString() ? `?${params}` : '';
    return apiFetch(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}/voice-activity${qs}`) as Promise<{
        available: boolean;
        speechMs?: number[];
    }>;
};

export const fetchMediaPlayerWatchlist = (force = false) => {
    if (!force && watchlistCache) return watchlistCache;
    watchlistCache = apiFetch(`${PLAYER_API_ROOT}/watchlist`) as Promise<{ items: PlayerItem[] }>;
    watchlistCache.catch(() => { watchlistCache = null; });
    return watchlistCache;
};

/** TV screensaver art pool for a chosen source (trending, popular, random, …). */
export const fetchMediaPlayerScreensaver = (source: string) => (
    apiFetch(`${PLAYER_API_ROOT}/screensaver?source=${encodeURIComponent(source)}`) as Promise<{
        source: string;
        items: PlayerItem[];
    }>
);

export const setMediaPlayerWatchlisted = (item: PlayerItem, watchlisted: boolean) => {
    watchlistCache = null;
    return apiFetch(`${PLAYER_API_ROOT}/watchlist`, {
        method: watchlisted ? 'POST' : 'DELETE',
        body: JSON.stringify({
            ratingKey: item.ratingKey,
            discoverRatingKey: item.discoverRatingKey || undefined,
            guid: item.plexGuid || item.showPlexGuid || undefined,
            serverId: item.serverId || undefined,
            remove: !watchlisted,
        }),
    }) as Promise<{ ok: boolean }>;
};

export const fetchMediaPlayerShuffleQueue = (ratingKey: string, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/queue/shuffle/${encodeURIComponent(ratingKey)}`, serverId)) as Promise<{ items: PlayerItem[] }>
);

export const fetchMediaPlayerPlayFromQueue = (ratingKey: string, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/queue/from/${encodeURIComponent(ratingKey)}`, serverId)) as Promise<{ items: PlayerItem[] }>
);

export const setMediaPlayerRating = (ratingKey: string, rating: number, serverId?: string | null) => (
    apiFetch(withServerQuery(`${PLAYER_API_ROOT}/item/${encodeURIComponent(ratingKey)}/rate`, serverId), {
        method: 'POST',
        body: JSON.stringify({ rating, serverId: serverId || undefined }),
    }) as Promise<{ ok: boolean; rating: number }>
);

export const startMediaPlayerPlayback = (ratingKey: string, opts: {
    offsetMs?: number | null;
    qualityId?: string;
    mediaIndex?: number;
    audioLanguage?: string;
    subtitleMode?: string;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    serverId?: string | null;
    delivery?: string | null;
    /** Reuse after stop — keeps Now Playing from spawning a new ghost per seek. */
    sessionId?: string | null;
    /**
     * Deprecated: host-stream gate removed (sync-only Watch Together).
     * Kept on the type so older call sites compile; ignored at runtime.
     */
    watchTogether?: string | null;
} = {}) => {
    const caps = browserPlaybackCaps();
    const isNativeApp = typeof window !== 'undefined' && !!window.__PLEX_CLIENT__;
    const qs = new URLSearchParams({ client: isNativeApp ? 'android' : 'web' });
    if (isNativeApp) {
        qs.set('textSubs', '1');
        qs.set('hevc', '1');
        qs.set('ac3', '1');
        // Match Settings → Bitstream so portal Direct Play picks the same audio as Exo.
        try {
            const raw = window.localStorage?.getItem('portal-media-player-settings');
            if (raw && JSON.parse(raw)?.audioPassthrough === true) qs.set('audioPassthrough', '1');
        } catch {
            /* ignore */
        }
    }
    if (opts.offsetMs != null) qs.set('offsetMs', String(opts.offsetMs));
    if (opts.qualityId && opts.qualityId !== 'auto') qs.set('qualityId', opts.qualityId);
    if (opts.mediaIndex != null) qs.set('mediaIndex', String(opts.mediaIndex));
    if (opts.audioLanguage) qs.set('audioLanguage', opts.audioLanguage);
    if (opts.subtitleMode) qs.set('subtitleMode', opts.subtitleMode);
    if (opts.audioStreamId != null && String(opts.audioStreamId).replace(/\D/g, '')) {
        qs.set('audioStreamId', String(opts.audioStreamId).replace(/\D/g, ''));
    }
    if (opts.subtitleStreamId !== undefined) {
        qs.set('subtitleStreamId', String(opts.subtitleStreamId || '').replace(/\D/g, '') || '0');
    }
    if (opts.serverId) qs.set('server', opts.serverId);
    if (opts.delivery) qs.set('delivery', opts.delivery);
    if (opts.sessionId) qs.set('sessionId', String(opts.sessionId).trim());
    if (caps.hevc) qs.set('canPlayHevc', '1');
    if (caps.ac3) qs.set('canPlayAc3', '1');
    if (caps.hls) qs.set('canPlayNativeHls', '1');
    return apiFetch(`${PLAYER_API_ROOT}/play/${encodeURIComponent(ratingKey)}?${qs}`) as Promise<PlayerPlaySession>;
};

export const reportMediaPlayerTimeline = (payload: {
    ratingKey: string;
    sessionId: string;
    state: 'playing' | 'paused' | 'buffering' | 'stopped';
    timeMs: number;
    durationMs: number;
    audioStreamId?: string | null;
    subtitleStreamId?: string | null;
    serverId?: string | null;
}) => (
    apiFetch(`${PLAYER_API_ROOT}/timeline`, {
        method: 'POST',
        body: JSON.stringify(payload),
        keepalive: true,
    }).catch(() => undefined)
);

export const stopMediaPlayerTranscode = (
    sessionId?: string | null,
    opts: { serverId?: string | null; ratingKey?: string | null } = {},
) => {
    const id = String(sessionId || '').trim();
    if (!id) return Promise.resolve();
    return apiFetch(`${PLAYER_API_ROOT}/stop`, {
        method: 'POST',
        body: JSON.stringify({
            sessionId: id,
            serverId: opts.serverId || undefined,
            ratingKey: opts.ratingKey || undefined,
        }),
        keepalive: true,
    }).catch(() => undefined);
};
