/**
 * Discover music enrichment — Lidarr search/posters + library rows.
 */

import {
    fetchLidarrAlbumsForArtist,
    findLidarrArtistInLibrary,
    getArrInstances,
    isArrInstanceReady,
    lookupLidarrArtist,
    pickLidarrArtistImage,
} from './arr-service.js';
import { searchMusicBrainzArtists } from './musicbrainz-client.js';

export const mapLidarrArtistToDiscoverItem = (artist = {}, instance = null) => {
    const mbid = String(artist?.foreignArtistId || artist?.artistMetadata?.foreignArtistId || '').trim();
    if (!mbid) return null;
    const name = String(artist?.artistName || artist?.name || '').trim();
    if (!name) return null;
    const posterUrl = pickLidarrArtistImage(artist, { instance });
    const inLibrary = Number(artist?.id) > 0;
    return {
        mbid,
        id: mbid,
        mediaType: 'music',
        type: 'music',
        name,
        title: name,
        overview: artist?.overview || '',
        posterPath: posterUrl,
        posterUrl,
        ...(inLibrary ? {
            mediaInfo: {
                id: Number(artist.id),
                mbid,
                status: 4, // PARTIAL until live enrich upgrades to AVAILABLE
                mediaType: 'music',
            },
            lidarrLibraryStatus: {
                matched: true,
                artistId: artist.id,
                instanceId: instance?.id || null,
                instanceName: instance?.name || 'Lidarr',
                source: 'catalog',
            },
        } : {
            lidarrLibraryStatus: {
                matched: false,
                instanceId: instance?.id || null,
                instanceName: instance?.name || 'Lidarr',
                source: 'lookup',
            },
        }),
    };
};

export const listRecentLidarrArtists = async (config, { limit = 30, fetchImpl = fetch } = {}) => {
    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) return [];

    const fetchOpts = { fetchImpl, timeoutMs: 15000 };
    const { fetchArrInstanceCatalogItems } = await import('./arr-service.js');
    const rows = [];
    for (const instance of instances) {
        const list = await fetchArrInstanceCatalogItems(instance, fetchOpts).catch(() => []);
        for (const artist of (Array.isArray(list) ? list : [])) {
            const mapped = mapLidarrArtistToDiscoverItem(artist, instance);
            if (mapped) rows.push({ ...mapped, dateAdded: artist?.added || artist?.dateAdded || null });
        }
    }
    rows.sort((a, b) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')));
    return rows.slice(0, Math.max(1, limit));
};

/**
 * Fast artist search via Lidarr metadata lookup (includes images + in-library id).
 */
export const searchLidarrArtists = async (config, query, {
    limit = 20,
    fetchImpl = fetch,
} = {}) => {
    const q = String(query || '').trim();
    if (q.length < 2) return { results: [], total: 0, source: 'lidarr' };

    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) return { results: [], total: 0, source: 'lidarr' };

    const seen = new Set();
    const results = [];
    for (const instance of instances) {
        // Lidarr lookup returns an array for free-text terms.
        const payload = await fetchArrInstanceJsonSafe(instance, q, { fetchImpl });
        for (const artist of payload) {
            const mapped = mapLidarrArtistToDiscoverItem(artist, instance);
            if (!mapped || seen.has(mapped.mbid)) continue;
            seen.add(mapped.mbid);
            results.push(mapped);
            if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
    }

    return { results, total: results.length, source: 'lidarr' };
};

/**
 * Hybrid artist search: MusicBrainz ranking (correct "Jay-Z is Jay-Z" results)
 * merged with Lidarr lookup data (posters + in-library ids). Falls back to
 * Lidarr-only when MusicBrainz is down or slow.
 */
export const searchMusicArtists = async (config, query, {
    limit = 20,
    fetchImpl = fetch,
} = {}) => {
    const q = String(query || '').trim();
    if (q.length < 2) return { results: [], total: 0, source: 'none' };

    const timeboxed = (promise, ms) => Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);

    const [mbRes, lidarrRes] = await Promise.all([
        timeboxed(searchMusicBrainzArtists(q, { limit, fetchImpl }).catch(() => null), 6000),
        searchLidarrArtists(config, q, { limit, fetchImpl }).catch(() => null),
    ]);

    const lidarrResults = Array.isArray(lidarrRes?.results) ? lidarrRes.results : [];
    const lidarrByMbid = new Map(lidarrResults.map((item) => [item.mbid, item]));
    const mbResults = Array.isArray(mbRes?.results) ? mbRes.results : [];

    if (!mbResults.length) {
        return { results: lidarrResults.slice(0, limit), total: lidarrResults.length, source: 'lidarr' };
    }

    const seen = new Set();
    const merged = [];
    for (const hit of mbResults) {
        if (!hit?.mbid || seen.has(hit.mbid)) continue;
        seen.add(hit.mbid);
        const lidarrHit = lidarrByMbid.get(hit.mbid);
        merged.push(lidarrHit
            ? { ...hit, ...lidarrHit, overview: hit.overview || lidarrHit.overview }
            : hit);
        if (merged.length >= limit) break;
    }
    // Lidarr-only hits (e.g. library artists MusicBrainz search missed) go last.
    for (const item of lidarrResults) {
        if (merged.length >= limit) break;
        if (seen.has(item.mbid)) continue;
        seen.add(item.mbid);
        merged.push(item);
    }

    return { results: merged, total: merged.length, source: 'musicbrainz+lidarr' };
};

/**
 * Per-album Lidarr availability for one artist: mbid → monitored/track stats.
 * Returns null when the artist is not in any Lidarr library.
 */
const ALBUM_AVAILABILITY_CACHE_MS = 60 * 1000;
const albumAvailabilityCache = new Map(); // artistMbid → { at, value }

export const fetchLidarrAlbumAvailabilityByMbid = async (config, artistMbid, { fetchImpl = fetch } = {}) => {
    const id = String(artistMbid || '').trim();
    if (!id) return null;
    const cached = albumAvailabilityCache.get(id);
    if (cached && Date.now() - cached.at < ALBUM_AVAILABILITY_CACHE_MS) return cached.value;
    const value = await fetchLidarrAlbumAvailabilityUncached(config, id, { fetchImpl });
    if (albumAvailabilityCache.size > 200) albumAvailabilityCache.clear();
    albumAvailabilityCache.set(id, { at: Date.now(), value });
    return value;
};

const fetchLidarrAlbumAvailabilityUncached = async (config, id, { fetchImpl }) => {
    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    for (const instance of instances) {
        const artist = await findLidarrArtistInLibrary(instance, id, { fetchImpl, timeoutMs: 12000 }).catch(() => null);
        if (!artist?.id) continue;
        const albums = await fetchLidarrAlbumsForArtist(instance, artist.id, { fetchImpl, timeoutMs: 12000 }).catch(() => []);
        const byMbid = new Map();
        for (const album of albums) {
            const albumMbid = String(album?.foreignAlbumId || '').trim();
            if (!albumMbid) continue;
            const total = Number(album?.statistics?.trackCount ?? album?.statistics?.totalTrackCount ?? 0);
            const files = Number(album?.statistics?.trackFileCount ?? 0);
            byMbid.set(albumMbid, {
                lidarrAlbumId: Number(album?.id) || null,
                monitored: !!album?.monitored,
                trackCount: total,
                trackFileCount: files,
                available: total > 0 && files >= total,
                partial: files > 0 && files < total,
            });
        }
        return { instance, artist, albumsByMbid: byMbid };
    }
    return null;
};

const fetchArrInstanceJsonSafe = async (instance, query, { fetchImpl }) => {
    try {
        const { fetchArrInstanceJson } = await import('./arr-service.js');
        const payload = await fetchArrInstanceJson(
            instance,
            `/api/v1/artist/lookup?term=${encodeURIComponent(query)}`,
            { fetchImpl, timeoutMs: 12000 },
        );
        return Array.isArray(payload) ? payload : [];
    } catch {
        return [];
    }
};

const LIDARR_ARTIST_CACHE_MS = 10 * 60 * 1000;
const lidarrArtistCache = new Map(); // mbid → { at, item }

/** Resolve a single artist from Lidarr by MusicBrainz id (library or metadata lookup). */
export const fetchLidarrArtistByMbid = async (config, mbid, { fetchImpl = fetch } = {}) => {
    const id = String(mbid || '').trim();
    if (!id) return null;
    const cached = lidarrArtistCache.get(id);
    if (cached && Date.now() - cached.at < LIDARR_ARTIST_CACHE_MS) return cached.item;
    const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
        .filter(isArrInstanceReady);
    if (!instances.length) return null;

    for (const instance of instances) {
        try {
            // Lidarr mbid lookup returns the artist and includes `id` when already in library.
            const lookup = await lookupLidarrArtist(instance, `mbid:${id}`, {
                fetchImpl,
                timeoutMs: 12000,
            });
            if (lookup) {
                const item = mapLidarrArtistToDiscoverItem(lookup, instance);
                if (lidarrArtistCache.size > 300) lidarrArtistCache.clear();
                lidarrArtistCache.set(id, { at: Date.now(), item });
                return item;
            }
        } catch {
            // try next instance
        }
    }
    return null;
};

/**
 * Attach poster URLs to MusicBrainz search hits from Lidarr catalog only.
 * Cover Art Archive lookups are intentionally skipped here — they are rate-limited
 * and made search feel broken (tens of seconds / timeouts).
 */
export const enrichMusicSearchPosters = async (results = [], {
    config = {},
    fetchImpl = fetch,
    catalogByMbid = null,
} = {}) => {
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return list;

    let catalog = catalogByMbid;
    if (!catalog) {
        catalog = new Map();
        const instances = getArrInstances(config, { type: 'lidarr', enabledOnly: true })
            .filter(isArrInstanceReady);
        if (instances.length) {
            const { fetchArrInstanceCatalogItems } = await import('./arr-service.js');
            await Promise.all(instances.map(async (instance) => {
                const artists = await fetchArrInstanceCatalogItems(instance, { fetchImpl, timeoutMs: 12000 }).catch(() => []);
                for (const artist of (Array.isArray(artists) ? artists : [])) {
                    const mbid = String(artist?.foreignArtistId || '').trim();
                    if (mbid && !catalog.has(mbid)) catalog.set(mbid, { artist, instance });
                }
            }));
        }
    }

    return list.map((hit) => {
        const mbid = String(hit?.mbid || hit?.id || '').trim();
        if (!mbid) return hit;
        const inLibrary = catalog.get(mbid);
        if (!inLibrary?.artist) return hit;
        const posterUrl = pickLidarrArtistImage(inLibrary.artist, { instance: inLibrary.instance });
        return {
            ...hit,
            posterPath: posterUrl || hit.posterPath,
            posterUrl: posterUrl || hit.posterUrl,
            lidarrLibraryStatus: {
                matched: true,
                artistId: inLibrary.artist.id,
                instanceId: inLibrary.instance?.id || null,
                source: 'catalog',
            },
        };
    });
};
