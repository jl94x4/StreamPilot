export const PLEX_TRACK_MATCH_BATCH = 4;
export const PLEX_TRACK_MATCH_CONCURRENCY = 2;
export const PLEX_CACHE_LOOKUP_BATCH = 80;

export const isSpotifySyncTimeoutError = (error) => {
    const status = Number(error?.status);
    if (status === 408 || status === 504 || status === 524) return true;
    return /timed out|timeout|aborted|504|524/i.test(String(error?.message || error || ''));
};

export const runPool = async (items, concurrency, worker) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const limit = Math.max(1, Math.min(list.length, Number(concurrency) || 1));
    const results = new Array(list.length);
    let next = 0;
    const run = async () => {
        while (next < list.length) {
            const index = next;
            next += 1;
            results[index] = await worker(list[index], index);
        }
    };
    await Promise.all(Array.from({ length: limit }, () => run()));
    return results;
};

export const normalizeSpotifyTracks = (data) => {
    const tracks = Array.isArray(data?.tracks)
        ? data.tracks
        : (Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
    return tracks
        .filter((track) => track && (track.id || track.title || track.name))
        .map((track) => ({
            id: String(track.id || ''),
            title: String(track.title || track.name || ''),
            artists: Array.isArray(track.artists)
                ? track.artists.map((artist) => (typeof artist === 'string' ? artist : String(artist?.name || ''))).filter(Boolean)
                : (track.artist ? [String(track.artist)] : []),
            album: String(track.album || ''),
            album_id: String(track.album_id || track.albumId || 'unknown'),
        }));
};

export const toPlexSearchItems = (tracks = []) => tracks.map((track) => ({
    id: track.id,
    title: track.title,
    artists: track.artists,
    album: track.album,
    album_id: track.album_id,
}));

export const mergeSearchResults = (cached = [], searched = []) => {
    const byId = new Map();
    for (const item of [...cached, ...searched]) {
        if (!item) continue;
        const key = String(item.id || `${item.title || ''}|${item.artist || ''}`);
        if (!byId.has(key)) byId.set(key, item);
    }
    return [...byId.values()];
};

export const isAllowedPlaylistArtworkUrl = (url, { allowPrivate = false } = {}) => {
    let parsed;
    try {
        parsed = new URL(String(url || '').trim());
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return !!allowPrivate;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return !!allowPrivate;
    return true;
};

const asArtworkUrl = (value) => String(value?.url || value?.image || value || '').trim();

export const collectPlaylistArtworkUrls = ({ savedItem, spotifyData, workerBase = '' } = {}) => {
    const base = String(workerBase || '').replace(/\/+$/, '');
    const raw = [
        savedItem?.image,
        spotifyData?.image,
        ...(Array.isArray(spotifyData?.images) ? spotifyData.images : []),
    ];
    const urls = [];
    const seen = new Set();
    for (const value of raw) {
        const url = asArtworkUrl(value);
        if (!url) continue;
        let resolved = '';
        if (/^https?:\/\//i.test(url)) resolved = url;
        else if (url.startsWith('/api/') && base) resolved = `${base}${url}`;
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        urls.push(resolved);
    }
    return urls;
};

export const pickUploadedPosterKey = (data) => {
    const raw = String(data?.raw || '');
    if (raw && !data?.MediaContainer) {
        const match = raw.match(/ratingKey="((?:upload:)?[^"]*upload[^"]*)"/i)
            || raw.match(/ratingKey="(upload:[^"]+)"/i);
        if (match?.[1]) return match[1];
    }
    const container = data?.MediaContainer || {};
    const rows = container.Metadata || container.Photo || [];
    const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
    const uploaded = [...list].reverse().find((item) => (
        /upload/i.test(String(item?.ratingKey || item?.key || ''))
    ));
    const chosen = uploaded || list.find((item) => item?.selected) || list[list.length - 1];
    return String(chosen?.ratingKey || '').trim();
};

const plexUrlWithToken = (base, path, token, extraQuery = '') => {
    const url = `${String(base || '').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
    const params = [`X-Plex-Token=${encodeURIComponent(token)}`];
    if (extraQuery) params.push(extraQuery.replace(/^\?/, ''));
    return `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}`;
};

const readFetchPayload = async (response) => {
    const text = await response.text();
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
};

export const applyPlexPlaylistArtwork = async ({
    ratingKey,
    imageUrls = [],
    fetchImage,
    uploadPoster,
} = {}) => {
    const id = String(ratingKey || '').trim();
    const urls = (Array.isArray(imageUrls) ? imageUrls : [imageUrls]).map((url) => String(url || '').trim()).filter(Boolean);
    if (!id || !urls.length || typeof fetchImage !== 'function' || typeof uploadPoster !== 'function') {
        return { ok: false, skipped: true };
    }
    let lastError = null;
    for (const url of urls) {
        try {
            const image = await fetchImage(url);
            const buffer = image?.buffer || image?.buf;
            if (!buffer?.length) continue;
            await uploadPoster({
                ratingKey: id,
                buffer,
                contentType: String(image.contentType || 'image/jpeg').split(';')[0] || 'image/jpeg',
                imageUrl: url,
            });
            return { ok: true, url };
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    return { ok: false, skipped: true };
};

export const createPlaylistArtworkApplier = ({
    fetchImpl,
    plexBaseUrl,
    plexToken,
    plexHeaders = () => ({}),
    allowPrivate = false,
    log = () => {},
} = {}) => {
    const base = String(plexBaseUrl || '').replace(/\/+$/, '');
    const token = String(plexToken || '').trim();
    if (!base || !token || typeof fetchImpl !== 'function') return null;

    const plexFetch = async (path, { method = 'GET', body, contentType, extraQuery = '' } = {}) => {
        const url = plexUrlWithToken(base, path, token, extraQuery);
        const headers = {
            ...plexHeaders(token, {
                Accept: 'application/json',
                ...(contentType ? { 'Content-Type': contentType } : {}),
            }),
        };
        const response = await fetchImpl(url, {
            method,
            headers,
            ...(body != null ? { body } : {}),
        });
        if (!response?.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Plex ${method} ${path} HTTP ${response?.status || 0}${text ? `: ${text.slice(0, 160)}` : ''}`);
        }
        return response;
    };

    const selectUploadedPoster = async (id) => {
        const listed = await plexFetch(`/library/metadata/${encodeURIComponent(id)}/posters`);
        const payload = await readFetchPayload(listed);
        const key = pickUploadedPosterKey(payload);
        if (!key) return false;
        await plexFetch(`/library/metadata/${encodeURIComponent(id)}/poster`, {
            method: 'PUT',
            extraQuery: `url=${encodeURIComponent(key)}`,
        });
        return true;
    };

    return ({ ratingKey, imageUrls } = {}) => applyPlexPlaylistArtwork({
        ratingKey,
        imageUrls: (Array.isArray(imageUrls) ? imageUrls : []).filter((url) => (
            isAllowedPlaylistArtworkUrl(url, { allowPrivate })
        )),
        fetchImage: async (url) => {
            const response = await fetchImpl(url, {
                headers: {
                    Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8,*/*;q=0.5',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                },
            });
            if (!response?.ok) throw new Error(`Artwork HTTP ${response?.status || 0}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (!buffer.length) throw new Error('Playlist artwork was empty.');
            const contentType = String(response.headers?.get?.('content-type') || 'image/jpeg').split(';')[0].trim();
            return {
                buffer,
                contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
            };
        },
        uploadPoster: async ({ ratingKey: id, buffer, contentType, imageUrl }) => {
            const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
            const paths = [
                `/library/metadata/${encodeURIComponent(id)}/posters`,
                `/playlists/${encodeURIComponent(id)}/posters`,
            ];
            const errors = [];
            for (const path of paths) {
                try {
                    await plexFetch(path, {
                        method: 'POST',
                        body: bytes,
                        contentType: contentType || 'image/jpeg',
                    });
                    try {
                        await selectUploadedPoster(id);
                    } catch (selectError) {
                        log(`[spotify-sync] Poster uploaded but not selected: ${selectError?.message || selectError}`);
                    }
                    return;
                } catch (error) {
                    errors.push(error);
                }
            }
            if (/^https?:\/\//i.test(String(imageUrl || '')) && isAllowedPlaylistArtworkUrl(imageUrl, { allowPrivate })) {
                for (const path of paths) {
                    try {
                        await plexFetch(path, {
                            method: 'POST',
                            extraQuery: `url=${encodeURIComponent(imageUrl)}`,
                        });
                        try {
                            await selectUploadedPoster(id);
                        } catch (selectError) {
                            log(`[spotify-sync] Poster URL uploaded but not selected: ${selectError?.message || selectError}`);
                        }
                        return;
                    } catch (error) {
                        errors.push(error);
                    }
                }
            }
            throw errors[0] || new Error('Plex rejected the playlist poster.');
        },
    });
};

const plexItemFromMatch = (row) => {
    const first = Array.isArray(row?.result) ? row.result[0] : null;
    if (!first?.id) return null;
    return { key: first.id, source: first.source };
};

const matchRowKey = (row) => String(row?.id || `${row?.title || ''}|${row?.artist || ''}`);

const trackMatchKey = (track) => String(track?.id || `${track?.title || ''}|${track?.artists?.[0] || track?.artist || ''}`);

export const matchedPlexItems = (tracks = [], results = []) => {
    const byKey = new Map();
    for (const row of results) {
        if (!row) continue;
        const key = matchRowKey(row);
        if (key && key !== '|' && !byKey.has(key)) byKey.set(key, row);
    }
    const items = [];
    const list = Array.isArray(tracks) && tracks.length ? tracks : results;
    for (const track of list) {
        const row = byKey.get(trackMatchKey(track)) || (track?.result ? track : null);
        const item = plexItemFromMatch(row);
        if (item) items.push(item);
    }
    return items;
};

export const chunkItems = (items = [], size = PLEX_TRACK_MATCH_BATCH) => {
    const out = [];
    const step = Math.max(1, Number(size) || PLEX_TRACK_MATCH_BATCH);
    for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
    return out;
};

export const matchPlexTrackBatch = async ({
    batch = [],
    type,
    playlistId,
    fetchJson,
    fast = true,
} = {}) => {
    const items = Array.isArray(batch) ? batch : [];
    if (!items.length) return [];
    try {
        const result = await fetchJson({
            path: '/api/plex/tracks',
            method: 'POST',
            body: {
                items,
                type,
                fast: !!fast,
                ...(type === 'spotify-album' ? { album: playlistId } : {}),
            },
            timeoutMs: 80000,
        });
        return Array.isArray(result) ? result : [];
    } catch (error) {
        if (!isSpotifySyncTimeoutError(error)) throw error;
        if (items.length > 1) {
            const mid = Math.ceil(items.length / 2);
            const left = await matchPlexTrackBatch({
                batch: items.slice(0, mid),
                type,
                playlistId,
                fetchJson,
                fast: true,
            });
            const right = await matchPlexTrackBatch({
                batch: items.slice(mid),
                type,
                playlistId,
                fetchJson,
                fast: true,
            });
            return [...left, ...right];
        }
        return [{ id: items[0]?.id, result: [] }];
    }
};

const asSavedItem = (data, id) => {
    if (Array.isArray(data)) return data.find((item) => item?.id === id) || data[0] || null;
    if (data && typeof data === 'object' && data.id) return data;
    return null;
};

export const syncSpotifyPlaylistToPlex = async ({
    id,
    fetchJson,
    onProgress = () => {},
    fast = true,
    applyArtwork = null,
    workerBase = '',
} = {}) => {
    const playlistId = String(id || '').trim();
    if (!playlistId) throw new Error('Playlist id is required.');
    if (typeof fetchJson !== 'function') throw new Error('Spotify Sync worker client is missing.');

    onProgress({ stage: 'load', message: 'Loading Spotify tracks…', done: 0, total: 0 });
    const saved = await fetchJson({
        path: `/api/saved-items?id=${encodeURIComponent(playlistId)}`,
        timeoutMs: 30000,
    });
    const savedItem = asSavedItem(saved, playlistId);
    if (!savedItem?.id) {
        throw new Error('Save this playlist first, then sync it to Plex.');
    }

    const spotifyData = await fetchJson({
        path: `/api/spotify/items/${encodeURIComponent(playlistId)}?full=1`,
        timeoutMs: 120000,
    });
    const tracks = normalizeSpotifyTracks(spotifyData);
    if (!tracks.length) {
        throw new Error('Spotify returned no tracks for this playlist.');
    }

    const searchItems = toPlexSearchItems(tracks);
    onProgress({ stage: 'cache', message: 'Checking Plex match cache…', done: 0, total: tracks.length });
    const cached = [];
    for (const cacheBatch of chunkItems(searchItems, PLEX_CACHE_LOOKUP_BATCH)) {
        try {
            const cachedResult = await fetchJson({
                path: '/api/plex/cached',
                method: 'POST',
                body: { items: cacheBatch },
                timeoutMs: 60000,
            });
            if (Array.isArray(cachedResult)) cached.push(...cachedResult);
        } catch {
            // Keep matching even if a cache lookup times out.
        }
    }

    const cachedIds = new Set(cached.map((item) => item?.id).filter(Boolean));
    const remaining = searchItems.filter((item) => !cachedIds.has(item.id));
    const searched = [];
    const type = savedItem.type === 'spotify-album' ? 'spotify-album' : 'spotify-playlist';
    let completed = 0;

    onProgress({
        stage: 'match',
        message: cached.length
            ? `Matching tracks in Plex (${cached.length}/${tracks.length} cached)…`
            : `Matching tracks in Plex (0/${tracks.length})…`,
        done: cached.length,
        total: tracks.length,
    });

    await runPool(chunkItems(remaining, PLEX_TRACK_MATCH_BATCH), PLEX_TRACK_MATCH_CONCURRENCY, async (batch) => {
        const batchResult = await matchPlexTrackBatch({
            batch,
            type,
            playlistId,
            fetchJson,
            fast,
        });
        if (Array.isArray(batchResult)) searched.push(...batchResult);
        completed += batch.length;
        onProgress({
            stage: 'match',
            message: `Matching tracks in Plex (${cached.length + completed}/${tracks.length})…`,
            done: cached.length + completed,
            total: tracks.length,
        });
        return batchResult;
    });

    const matches = mergeSearchResults(cached, searched);
    const plexItems = matchedPlexItems(tracks, matches);
    if (!plexItems.length) {
        throw new Error('None of these tracks were found in your Plex music library.');
    }

    const title = String(savedItem.title || spotifyData?.title || playlistId);
    const artworkUrls = collectPlaylistArtworkUrls({ savedItem, spotifyData, workerBase });
    const thumb = artworkUrls.find((url) => /^https?:\/\//i.test(url)) || '';
    const payload = {
        type,
        id: playlistId,
        name: title,
        thumb,
        items: plexItems,
    };

    onProgress({ stage: 'write', message: 'Writing playlist to Plex…', done: tracks.length, total: tracks.length });
    let existing = null;
    try {
        existing = await fetchJson({
            path: `/api/playlists/${encodeURIComponent(playlistId)}`,
            timeoutMs: 30000,
        });
    } catch (error) {
        if (Number(error?.status) !== 404) throw error;
    }

    const result = existing?.id
        ? await fetchJson({
            path: `/api/playlists/${encodeURIComponent(playlistId)}`,
            method: 'PUT',
            body: payload,
            timeoutMs: 120000,
        })
        : await fetchJson({
            path: '/api/playlists',
            method: 'POST',
            body: payload,
            timeoutMs: 120000,
        });

    const plexId = result?.id || existing?.id || null;
    let artworkApplied = false;
    if (plexId && artworkUrls.length && typeof applyArtwork === 'function') {
        onProgress({ stage: 'poster', message: 'Applying playlist artwork…', done: tracks.length, total: tracks.length });
        try {
            const artwork = await applyArtwork({ ratingKey: plexId, imageUrls: artworkUrls });
            artworkApplied = artwork?.ok === true;
        } catch (error) {
            artworkApplied = false;
            onProgress({
                stage: 'poster',
                message: `Playlist artwork failed: ${error?.message || error}`,
                done: tracks.length,
                total: tracks.length,
            });
        }
    }

    const matched = plexItems.length;
    const missing = Math.max(0, tracks.length - matched);
    return {
        ok: true,
        created: !existing?.id,
        id: playlistId,
        title,
        matched,
        missing,
        total: tracks.length,
        plexId,
        artworkApplied,
        link: result?.link || existing?.link || '',
        message: existing?.id
            ? `Updated “${title}” on Plex (${matched}/${tracks.length} tracks).`
            : `Created “${title}” on Plex (${matched}/${tracks.length} tracks).`,
    };
};

export const savedPlaylistIds = (items = []) => asItemArrayLike(items)
    .filter((item) => item?.id && item.type !== 'plex-media')
    .map((item) => String(item.id));

const asItemArrayLike = (data) => (Array.isArray(data) ? data : []);

export const summarizePlaylistSyncResults = (results = []) => {
    const ok = results.filter((item) => item?.ok);
    const failed = results.filter((item) => !item?.ok);
    const matched = ok.reduce((sum, item) => sum + Number(item.matched || 0), 0);
    const missing = ok.reduce((sum, item) => sum + Number(item.missing || 0), 0);
    let message = '';
    if (!results.length) message = 'No playlists to sync. Save a Spotify playlist first.';
    else if (results.length === 1) message = ok[0]?.message || failed[0]?.error || 'Sync failed.';
    else if (failed.length) {
        message = `Synced ${ok.length} playlist${ok.length === 1 ? '' : 's'} to Plex, ${failed.length} failed: ${failed[0].error}`;
    } else {
        message = `Synced ${ok.length} playlists to Plex (${matched} matched, ${missing} missing).`;
    }
    return {
        ok: results.length > 0 && failed.length === 0,
        results,
        matched,
        missing,
        message,
    };
};

export const syncSpotifyPlaylistsToPlex = async ({
    ids,
    all = false,
    fetchJson,
    onProgress = () => {},
    fast = true,
    applyArtwork = null,
    workerBase = '',
} = {}) => {
    let list = Array.isArray(ids) ? ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
    if (!list.length && all) {
        const saved = await fetchJson({ path: '/api/saved-items', timeoutMs: 30000 });
        list = savedPlaylistIds(saved);
    }
    if (!list.length) return summarizePlaylistSyncResults([]);
    const results = [];
    for (const id of list) {
        onProgress({ stage: 'playlist', id, message: `Syncing ${id} to Plex…` });
        try {
            results.push(await syncSpotifyPlaylistToPlex({
                id,
                fetchJson,
                onProgress,
                fast,
                applyArtwork,
                workerBase,
            }));
        } catch (error) {
            results.push({ ok: false, id, error: error?.message || String(error) });
        }
    }
    return summarizePlaylistSyncResults(results);
};
