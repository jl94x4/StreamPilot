/** Recently-added, browse, search, and artwork reset for Poster Sets Library tab. */

const PLEX_SORT_MAP = {
    titleAsc: 'titleSort:asc',
    titleDesc: 'titleSort:desc',
    yearDesc: 'year:desc',
    yearAsc: 'year:asc',
    addedDesc: 'addedAt:desc',
    addedAsc: 'addedAt:asc',
};

/** Plex /all without type= can return seasons/episodes; cache build needs series/movies. */
export const plexSectionAllTypeQuery = (sectionType) => {
    if (sectionType === 'show') return '&type=2';
    if (sectionType === 'movie') return '&type=1';
    return '';
};

const PLEX_PROVIDER_HYDRATE_CONCURRENCY = 8;

const runWithConcurrency = async (items, concurrency, worker) => {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    const limit = Math.max(1, Math.min(list.length, Number(concurrency) || PLEX_PROVIDER_HYDRATE_CONCURRENCY));
    const results = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: limit }, async () => {
        while (next < list.length) {
            const index = next;
            next += 1;
            results[index] = await worker(list[index], index);
        }
    }));
    return results;
};

const normalizeSort = (value) => (
    PLEX_SORT_MAP[String(value || '').trim()] ? String(value).trim() : 'titleAsc'
);

const dedupeRecentList = (list, limit) => {
    const unique = [];
    const seen = new Set();
    const sorted = [...list].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    for (const item of sorted) {
        const key = `${item.mediaType}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
        if (unique.length >= limit) break;
    }
    return unique;
};

const dedupePreserveOrder = (list, limit) => {
    const unique = [];
    const seen = new Set();
    const cap = Number.isFinite(Number(limit)) ? Number(limit) : Number.POSITIVE_INFINITY;
    for (const item of list) {
        const key = `${item.mediaType}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
        if (unique.length >= cap) break;
    }
    return unique;
};

const plexGuidList = (metadata = {}) => {
    const guids = [];
    if (Array.isArray(metadata.Guid)) {
        for (const entry of metadata.Guid) {
            if (entry?.id) guids.push(String(entry.id));
        }
    }
    if (metadata.guid) guids.push(String(metadata.guid));
    return guids;
};

const extractTmdbIdFromPlexMeta = (metadata = {}) => {
    for (const raw of plexGuidList(metadata)) {
        const match = raw.match(/(?:tmdb|themoviedb):\/\/(\d+)/i);
        if (match) return match[1];
    }
    return null;
};

/** TheTVDB id from Plex guids (common on TV libraries that never store TMDB). */
export const extractTvdbIdFromPlexMeta = (metadata = {}) => {
    for (const raw of plexGuidList(metadata)) {
        const match = raw.match(/(?:tvdb|thetvdb):\/\/(\d+)/i);
        if (match) return match[1];
    }
    return null;
};

const mapPlexRecentMetadata = (sectionType, metadata = {}, sectionTitle = null) => {
    if (sectionType !== 'movie' && sectionType !== 'show') return null;
    const mediaType = sectionType === 'movie' ? 'movie' : 'show';
    const isShow = mediaType === 'show';
    const id = isShow
        ? String(metadata.grandparentRatingKey || metadata.parentRatingKey || metadata.ratingKey || '').trim()
        : String(metadata.ratingKey || '').trim();
    const title = isShow
        ? String(metadata.grandparentTitle || metadata.parentTitle || metadata.title || '').trim()
        : String(metadata.title || '').trim();
    if (!title) return null;
    return {
        id: id || title,
        title,
        // Episode recently-added rows often carry the episode/season year (e.g. Sugar S2 → 2026)
        // while MediUX/TPDB catalog the premiere year (2024). Prefer show-level year when present.
        year: Number(
            isShow
                ? (metadata.grandparentYear || metadata.parentYear || metadata.year)
                : metadata.year,
        ) || null,
        mediaType,
        tmdbId: extractTmdbIdFromPlexMeta(metadata),
        tvdbId: extractTvdbIdFromPlexMeta(metadata),
        thumb: metadata.grandparentThumb || metadata.parentThumb || metadata.thumb || null,
        addedAt: Number(metadata.addedAt) || 0,
        librarySection: sectionTitle,
    };
};

/** Fill show year + TMDB/TVDB from series metadata — episode recently-added rows often omit both. */
const hydratePlexShowLibraryItems = async (uri, config, deps, shows = []) => {
    const { plexClientHeaders, fetchImpl = fetch } = deps;
    const uniqueIds = [...new Set(
        shows
            .filter((item) => item?.mediaType === 'show' && item?.id)
            .map((item) => String(item.id)),
    )];
    if (!uniqueIds.length) return shows;

    const headers = plexClientHeaders(config.plexToken);
    const byId = new Map();
    await runWithConcurrency(uniqueIds, PLEX_PROVIDER_HYDRATE_CONCURRENCY, async (id) => {
        try {
            const data = await fetchImpl(
                `${uri}/library/metadata/${encodeURIComponent(id)}?includeGuids=1&X-Plex-Token=${config.plexToken}`,
                { headers },
            ).then((response) => response.json()).catch(() => null);
            const meta = data?.MediaContainer?.Metadata?.[0];
            if (!meta) return;
            byId.set(id, {
                year: Number(meta.year) || null,
                tmdbId: extractTmdbIdFromPlexMeta(meta),
                tvdbId: extractTvdbIdFromPlexMeta(meta),
                title: String(meta.title || '').trim() || null,
                thumb: meta.thumb || null,
            });
        } catch {
            // Keep episode-derived fields when series lookup fails.
        }
    });
    if (!byId.size) return shows;

    return shows.map((item) => {
        if (item.mediaType !== 'show') return item;
        const hydrated = byId.get(String(item.id));
        if (!hydrated) return item;
        return {
            ...item,
            title: hydrated.title || item.title,
            // Prefer series year (premiere / show record) over episode season year.
            year: hydrated.year || item.year,
            tmdbId: hydrated.tmdbId || item.tmdbId,
            tvdbId: hydrated.tvdbId || item.tvdbId,
            thumb: item.thumb || hydrated.thumb || null,
        };
    });
};

export const fetchPlexLibraryRecent = async (config, deps, { limit = 120 } = {}) => {
    const { getPlexConnectionUri, plexClientHeaders, fetchImpl = fetch } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');

    const sectionsRes = await fetchImpl(
        `${uri}/library/sections?X-Plex-Token=${config.plexToken}`,
        { headers: plexClientHeaders(config.plexToken) },
    ).then((r) => r.json()).catch(() => null);
    const sections = (sectionsRes?.MediaContainer?.Directory || [])
        .filter((section) => section.type === 'movie' || section.type === 'show');

    if (!sections.length) {
        return { movies: [], shows: [], items: [] };
    }

    const perSectionLimit = Math.max(
        20,
        Math.min(50, Math.ceil(limit / Math.max(sections.length, 1)) + 5),
    );

    const buckets = await Promise.all(sections.map(async (section) => {
        const data = await fetchImpl(
            `${uri}/library/sections/${section.key}/recentlyAdded?X-Plex-Token=${config.plexToken}&X-Plex-Container-Start=0&X-Plex-Container-Size=${perSectionLimit}&includeGuids=1`,
            { headers: plexClientHeaders(config.plexToken) },
        ).then((r) => r.json()).catch(() => null);
        const metas = data?.MediaContainer?.Metadata || [];
        return metas
            .map((meta) => mapPlexRecentMetadata(section.type, meta, section.title))
            .filter(Boolean);
    }));

    const all = buckets.flat();
    const movies = dedupeRecentList(all.filter((item) => item.mediaType === 'movie'), limit);
    let shows = dedupeRecentList(all.filter((item) => item.mediaType === 'show'), limit);
    shows = await hydratePlexShowLibraryItems(uri, config, deps, shows);
    const items = dedupeRecentList([...movies, ...shows], limit);
    return { movies, shows, items };
};

export const searchPlexLibraryMedia = async (config, deps, { query, limit = 40 } = {}) => {
    const q = String(query || '').trim();
    if (!q) return [];
    const { getPlexConnectionUri, plexClientHeaders, fetchImpl = fetch } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');

    const searchRes = await fetchImpl(
        `${uri}/hubs/search?query=${encodeURIComponent(q)}&limit=${Math.min(limit, 80)}&includeGuids=1&X-Plex-Token=${config.plexToken}`,
        { headers: plexClientHeaders(config.plexToken) },
    ).then((r) => r.json()).catch(() => null);

    const results = [];
    const hubs = searchRes?.MediaContainer?.Hub || [];
    for (const hub of hubs) {
        const hubType = String(hub.type || '').toLowerCase();
        if (hubType !== 'movie' && hubType !== 'show') continue;
        for (const meta of (hub.Metadata || [])) {
            const mediaType = hubType === 'show' ? 'show' : 'movie';
            const title = String(meta.title || '').trim();
            if (!title) continue;
            results.push({
                id: String(meta.ratingKey || title),
                title,
                year: Number(meta.year) || null,
                mediaType,
                tmdbId: extractTmdbIdFromPlexMeta(meta),
                thumb: meta.thumb || null,
                addedAt: 0,
            });
            if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
    }
    return results;
};

const mapPlexBrowseMetadata = (sectionType, metadata = {}, sectionTitle = null) => {
    if (sectionType !== 'movie' && sectionType !== 'show') return null;
    const mediaType = sectionType === 'movie' ? 'movie' : 'show';
    const id = String(metadata.ratingKey || '').trim();
    const title = String(metadata.title || '').trim();
    if (!id || !title) return null;
    return {
        id,
        title,
        year: Number(metadata.year) || null,
        mediaType,
        tmdbId: extractTmdbIdFromPlexMeta(metadata),
        tvdbId: extractTvdbIdFromPlexMeta(metadata),
        thumb: metadata.thumb || null,
        addedAt: Number(metadata.addedAt) || 0,
        librarySection: sectionTitle,
        librarySectionKey: metadata.librarySectionKey || null,
    };
};

export const fetchPlexLibrarySections = async (config, deps) => {
    const { getPlexConnectionUri, plexClientHeaders, fetchImpl = fetch } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');

    const sectionsRes = await fetchImpl(
        `${uri}/library/sections?X-Plex-Token=${config.plexToken}`,
        { headers: plexClientHeaders(config.plexToken) },
    ).then((r) => r.json()).catch(() => null);

    const directories = (sectionsRes?.MediaContainer?.Directory || [])
        .filter((section) => section.type === 'movie' || section.type === 'show')
        .map((section) => ({
            key: String(section.key || ''),
            title: String(section.title || '').trim(),
            type: section.type === 'show' ? 'show' : 'movie',
            // Directory.size is often missing/0 in Plex JSON — prefer totalSize below.
            count: Number(section.size) || 0,
        }))
        .filter((section) => section.key && section.title);

    // Accurate counts: zero-size /all requests (same pattern as dashboard library stats).
    const counted = await Promise.all(directories.map(async (section) => {
        try {
            const data = await fetchImpl(
                `${uri}/library/sections/${section.key}/all`
                    + `?X-Plex-Token=${config.plexToken}`
                    + '&X-Plex-Container-Start=0&X-Plex-Container-Size=0'
                    + plexSectionAllTypeQuery(section.type),
                { headers: plexClientHeaders(config.plexToken) },
            ).then((r) => r.json()).catch(() => null);
            const mc = data?.MediaContainer || {};
            const count = Number(mc.totalSize) || Number(mc.size) || section.count || 0;
            return { ...section, count };
        } catch {
            return section;
        }
    }));

    return counted;
};

export const browsePlexLibraryMedia = async (config, deps, options = {}) => {
    const {
        sectionKey = '',
        mediaType = '',
        sort = 'titleAsc',
        start = 0,
        limit = 60,
    } = options;

    const { getPlexConnectionUri, plexClientHeaders, fetchImpl = fetch } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');

    const sections = await fetchPlexLibrarySections(config, deps);
    let targetSections = sections;
    if (sectionKey) {
        targetSections = sections.filter((section) => section.key === String(sectionKey));
    }
    if (mediaType === 'movie' || mediaType === 'show') {
        targetSections = targetSections.filter((section) => section.type === mediaType);
    }
    if (!targetSections.length) {
        return { items: [], total: 0, sections };
    }

    const plexSort = PLEX_SORT_MAP[normalizeSort(sort)] || PLEX_SORT_MAP.titleAsc;
    const maxTake = options.allowLarge === true ? 2000 : 120;
    const take = Math.min(Math.max(Number(limit) || 60, 1), maxTake);
    const offset = Math.max(Number(start) || 0, 0);
    const perSection = targetSections.length === 1
        ? take
        : Math.min(take, Math.max(20, Math.ceil(take / targetSections.length)));

    const buckets = await Promise.all(targetSections.map(async (section) => {
        const url = `${uri}/library/sections/${section.key}/all?X-Plex-Token=${config.plexToken}`
            + `&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${perSection}`
            + `&sort=${encodeURIComponent(plexSort)}&includeGuids=1`
            + plexSectionAllTypeQuery(section.type);
        const data = await fetchImpl(url, { headers: plexClientHeaders(config.plexToken) })
            .then((r) => r.json())
            .catch(() => null);
        const metas = data?.MediaContainer?.Metadata || [];
        const total = Number(data?.MediaContainer?.totalSize) || metas.length;
        return {
            total,
            items: metas.map((meta) => mapPlexBrowseMetadata(section.type, {
                ...meta,
                librarySectionKey: section.key,
            }, section.title)).filter(Boolean),
        };
    }));

    const items = dedupePreserveOrder(buckets.flatMap((bucket) => bucket.items), take);
    const total = buckets.reduce((sum, bucket) => sum + (bucket.total || 0), 0);
    return { items, total, sections: targetSections, sort: normalizeSort(sort) };
};

const plexMetadataPut = async (uri, token, ratingKey, query, deps) => {
    const { plexClientHeaders, fetchImpl = fetch } = deps;
    const url = `${uri}/library/metadata/${encodeURIComponent(String(ratingKey))}?${query}&X-Plex-Token=${encodeURIComponent(token)}`;
    const response = await fetchImpl(url, {
        method: 'PUT',
        headers: plexClientHeaders(token),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `Plex metadata update failed (${response.status})`);
    }
    return true;
};

const fetchPlexChildren = async (uri, token, ratingKey, deps) => {
    const { plexClientHeaders, fetchImpl = fetch } = deps;
    const url = `${uri}/library/metadata/${encodeURIComponent(String(ratingKey))}/children?X-Plex-Token=${encodeURIComponent(token)}`;
    const data = await fetchImpl(url, { headers: plexClientHeaders(token) })
        .then((r) => r.json())
        .catch(() => null);
    return data?.MediaContainer?.Metadata || [];
};

/** Reset Plex artwork to agent defaults (poster/thumb and optional art/seasons/episodes). */
export const resetPlexLibraryArtwork = async (config, deps, options = {}) => {
    const ratingKey = String(options.ratingKey || '').trim();
    const mediaType = String(options.mediaType || '').toLowerCase();
    const scope = String(options.scope || 'poster').toLowerCase();
    if (!ratingKey) throw new Error('ratingKey is required');

    const { getPlexConnectionUri } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) throw new Error('Cannot connect to Plex');

    const token = config.plexToken;
    let cleared = 0;

    const clearPoster = async (key) => {
        await plexMetadataPut(uri, token, key, 'thumb.clear=1', deps);
        cleared += 1;
    };
    const clearArt = async (key) => {
        await plexMetadataPut(uri, token, key, 'art.clear=1', deps);
        cleared += 1;
    };

    if (mediaType === 'movie') {
        await clearPoster(ratingKey);
        if (scope === 'all' || scope === 'art') {
            try { await clearArt(ratingKey); } catch { /* art may not exist */ }
        }
        return { ok: true, cleared };
    }

    if (mediaType === 'show') {
        await clearPoster(ratingKey);
        if (scope === 'all' || scope === 'art') {
            try { await clearArt(ratingKey); } catch { /* ignore */ }
        }
        if (scope === 'seasons' || scope === 'episodes' || scope === 'all') {
            const seasons = await fetchPlexChildren(uri, token, ratingKey, deps);
            for (const season of seasons) {
                const seasonKey = String(season.ratingKey || '').trim();
                if (!seasonKey) continue;
                if (scope === 'seasons' || scope === 'all') {
                    await clearPoster(seasonKey);
                }
                if (scope === 'episodes' || scope === 'all') {
                    const episodes = await fetchPlexChildren(uri, token, seasonKey, deps);
                    for (const episode of episodes) {
                        const episodeKey = String(episode.ratingKey || '').trim();
                        if (!episodeKey) continue;
                        await clearPoster(episodeKey);
                    }
                }
            }
        }
    }

    return { ok: true, cleared };
};

export const fetchJellyfinLibrarySections = async (config, deps) => {
    const { resolveIntegrationUrlForFetch, jellyfinHeaders, fetchWithTimeout } = deps;
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const response = await fetchWithTimeout(`${baseUrl}/Users/Me/Views`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 15000);
    const data = response.ok ? await response.json() : { Items: [] };
    const directories = (Array.isArray(data.Items) ? data.Items : [])
        .map((view) => {
            const collectionType = String(view.CollectionType || '').toLowerCase();
            // Jellyfin/Emby: tvshows (common), tvshow, series — folder-organized libs need recursive Series.
            const type = (collectionType === 'tvshows' || collectionType === 'tvshow' || collectionType === 'series')
                ? 'show'
                : collectionType === 'movies' || collectionType === 'movie'
                    ? 'movie'
                    : null;
            if (!type) return null;
            return {
                key: String(view.Id || ''),
                title: String(view.Name || '').trim(),
                type,
                // Views often omit ChildCount — fill via Items TotalRecordCount below.
                count: Number(view.ChildCount) || 0,
            };
        })
        .filter(Boolean);

    const counted = await Promise.all(directories.map(async (section) => {
        try {
            const itemType = section.type === 'show' ? 'Series' : 'Movie';
            const params = new URLSearchParams({
                ParentId: section.key,
                IncludeItemTypes: itemType,
                // Series are often nested under folders — always recurse like movies.
                Recursive: 'true',
                StartIndex: '0',
                Limit: '0',
                EnableTotalRecordCount: 'true',
            });
            const countRes = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
                headers: jellyfinHeaders(config.jellyfinApiKey),
            }, 15000);
            const countData = countRes.ok ? await countRes.json() : {};
            const count = Number(countData.TotalRecordCount) || section.count || 0;
            return { ...section, count };
        } catch {
            return section;
        }
    }));

    return counted;
};

const JELLYFIN_SORT_MAP = {
    titleAsc: { SortBy: 'SortName', SortOrder: 'Ascending' },
    titleDesc: { SortBy: 'SortName', SortOrder: 'Descending' },
    yearDesc: { SortBy: 'ProductionYear', SortOrder: 'Descending' },
    yearAsc: { SortBy: 'ProductionYear', SortOrder: 'Ascending' },
    addedDesc: { SortBy: 'DateCreated', SortOrder: 'Descending' },
    addedAsc: { SortBy: 'DateCreated', SortOrder: 'Ascending' },
};

export const browseJellyfinLibraryMedia = async (config, deps, options = {}) => {
    const {
        sectionKey = '',
        mediaType = '',
        sort = 'titleAsc',
        start = 0,
        limit = 60,
    } = options;
    const { resolveIntegrationUrlForFetch, jellyfinHeaders, fetchWithTimeout, withBasePath } = deps;
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const sections = await fetchJellyfinLibrarySections(config, deps);
    let targetSections = sections;
    if (sectionKey) {
        targetSections = sections.filter((section) => section.key === String(sectionKey));
    }
    if (mediaType === 'movie' || mediaType === 'show') {
        targetSections = targetSections.filter((section) => section.type === mediaType);
    }
    if (!targetSections.length) {
        return { items: [], total: 0, sections };
    }

    const sortConfig = JELLYFIN_SORT_MAP[normalizeSort(sort)] || JELLYFIN_SORT_MAP.titleAsc;
    const maxTake = options.allowLarge === true ? 2000 : 120;
    const take = Math.min(Math.max(Number(limit) || 60, 1), maxTake);
    const offset = Math.max(Number(start) || 0, 0);
    const section = targetSections[0];
    const itemType = section.type === 'show' ? 'Series' : 'Movie';
    const params = new URLSearchParams({
        ParentId: section.key,
        IncludeItemTypes: itemType,
        // Nested folders under TV views omit Series unless Recursive is true.
        Recursive: 'true',
        StartIndex: String(offset),
        Limit: String(take),
        SortBy: sortConfig.SortBy,
        SortOrder: sortConfig.SortOrder,
        Fields: 'ProductionYear,DateCreated,PrimaryImageAspectRatio,ImageTags,ProviderIds,SeriesId,SeriesName',
    });
    const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 20000);
    const data = response.ok ? await response.json() : { Items: [], TotalRecordCount: 0 };
    const items = (Array.isArray(data.Items) ? data.Items : [])
        .map((item) => {
            const mapped = mapJellyfinBrowseItem(config, item, section.type, withBasePath);
            if (!mapped) return null;
            return { ...mapped, librarySection: section.title, librarySectionKey: section.key };
        })
        .filter(Boolean);
    return {
        items,
        total: Number(data.TotalRecordCount) || items.length,
        sections: targetSections,
        sort: normalizeSort(sort),
    };
};

const extractJellyfinTmdbId = (item = {}) => {
    const ids = item?.ProviderIds || {};
    const raw = ids.Tmdb ?? ids.tmdb ?? ids.TmdbId ?? ids.TheMovieDb ?? ids.MovieDb;
    if (raw == null || raw === '') return null;
    const value = String(raw).trim();
    return /^\d+$/.test(value) ? value : null;
};

const extractJellyfinTvdbId = (item = {}) => {
    const ids = item?.ProviderIds || {};
    const raw = ids.Tvdb ?? ids.tvdb ?? ids.TvdbId ?? ids.TheTvDb ?? ids.TVDB;
    if (raw == null || raw === '') return null;
    const value = String(raw).trim();
    return /^\d+$/.test(value) ? value : null;
};

const mapJellyfinBrowseItem = (config, item = {}, mediaType = 'movie', withBasePath) => {
    const id = mediaType === 'show'
        ? String(item.SeriesId || item.Id || '')
        : String(item.Id || '');
    const title = mediaType === 'show'
        ? String(item.SeriesName || item.Name || '').trim()
        : String(item.Name || '').trim();
    if (!id || !title) return null;
    const posterId = mediaType === 'show' ? (item.SeriesId || item.Id) : item.Id;
    const height = mediaType === 'movie' ? 450 : 450;
    const width = mediaType === 'movie' ? 300 : 300;
    return {
        id,
        title,
        year: Number(item.ProductionYear) || null,
        mediaType,
        tmdbId: extractJellyfinTmdbId(item),
        tvdbId: extractJellyfinTvdbId(item),
        thumb: posterId,
        thumbUrl: posterId
            ? withBasePath(`/api/jellyfin/image?itemId=${encodeURIComponent(String(posterId))}&width=${width}&height=${height}`)
            : null,
        addedAt: item.DateCreated ? Math.floor(Date.parse(item.DateCreated) / 1000) : 0,
    };
};

export const fetchJellyfinLibraryRecent = async (config, deps, { limit = 120 } = {}) => {
    const { fetchJellyfinItems, withBasePath } = deps;
    const perTypeLimit = Math.max(40, Math.min(limit, 120));
    // Prefer Series (has series-level ProviderIds/TMDB). Episodes often only carry episode ids.
    const [moviesRaw, seriesRaw, episodesRaw] = await Promise.all([
        fetchJellyfinItems(config, 'Movie', perTypeLimit).catch(() => []),
        fetchJellyfinItems(config, 'Series', perTypeLimit).catch(() => []),
        fetchJellyfinItems(config, 'Episode', perTypeLimit).catch(() => []),
    ]);

    const movies = dedupeRecentList(
        (Array.isArray(moviesRaw) ? moviesRaw : [])
            .map((item) => mapJellyfinBrowseItem(config, item, 'movie', withBasePath))
            .filter(Boolean),
        limit,
    );

    const showMap = new Map();
    const pushShow = (mapped) => {
        if (!mapped) return;
        const key = mapped.id || mapped.title.toLowerCase();
        const existing = showMap.get(key);
        if (!existing) {
            showMap.set(key, mapped);
            return;
        }
        // Series rows are inserted first (real TMDB). Episodes may bump addedAt but must not
        // replace series TMDB with an episode-level provider id.
        showMap.set(key, {
            ...existing,
            ...mapped,
            tmdbId: existing.tmdbId || mapped.tmdbId,
            tvdbId: existing.tvdbId || mapped.tvdbId,
            year: existing.year || mapped.year,
            title: existing.title || mapped.title,
            thumb: existing.thumb || mapped.thumb,
            thumbUrl: existing.thumbUrl || mapped.thumbUrl,
            addedAt: Math.max(existing.addedAt || 0, mapped.addedAt || 0),
        });
    };
    for (const series of (Array.isArray(seriesRaw) ? seriesRaw : [])) {
        pushShow(mapJellyfinBrowseItem(config, series, 'show', withBasePath));
    }
    for (const ep of (Array.isArray(episodesRaw) ? episodesRaw : [])) {
        pushShow(mapJellyfinBrowseItem(config, ep, 'show', withBasePath));
    }
    const shows = dedupeRecentList([...showMap.values()], limit);
    const items = dedupeRecentList([...movies, ...shows], limit);
    return { movies, shows, items };
};

export const searchJellyfinLibraryMedia = async (config, deps, { query, limit = 40 } = {}) => {
    const q = String(query || '').trim();
    if (!q) return [];
    const { resolveIntegrationUrlForFetch, jellyfinHeaders, fetchWithTimeout, withBasePath } = deps;
    const baseUrl = resolveIntegrationUrlForFetch(config.jellyfinUrl);
    const params = new URLSearchParams({
        SearchTerm: q,
        IncludeItemTypes: 'Movie,Series',
        Limit: String(Math.min(limit, 80)),
        Recursive: 'true',
        Fields: 'ProductionYear,SeriesName,PrimaryImageAspectRatio,ImageTags,ProviderIds',
    });
    const response = await fetchWithTimeout(`${baseUrl}/Items?${params.toString()}`, {
        headers: jellyfinHeaders(config.jellyfinApiKey),
    }, 15000);
    const data = response.ok ? await response.json() : { Items: [] };
    const items = Array.isArray(data.Items) ? data.Items : [];
    const results = [];
    for (const item of items) {
        const type = String(item.Type || '').toLowerCase();
        const mediaType = type === 'series' ? 'show' : type === 'movie' ? 'movie' : null;
        if (!mediaType) continue;
        const mapped = mapJellyfinBrowseItem(config, item, mediaType, withBasePath);
        if (mapped) results.push(mapped);
        if (results.length >= limit) break;
    }
    return results;
};

export const fetchPlexItemTmdbId = async (config, deps, ratingKey) => {
    const ids = await fetchPlexItemProviderIds(config, deps, ratingKey);
    return ids?.tmdbId || null;
};

/** TMDB + TheTVDB ids from a Plex rating key (includeGuids). */
export const fetchPlexItemProviderIds = async (config, deps, ratingKey, { _depth = 0 } = {}) => {
    const key = String(ratingKey || '').trim();
    if (!key) return { tmdbId: null, tvdbId: null };
    const { getPlexConnectionUri, plexClientHeaders, fetchImpl = fetch } = deps;
    const uri = await getPlexConnectionUri(config);
    if (!uri) return { tmdbId: null, tvdbId: null };
    const data = await fetchImpl(
        `${uri}/library/metadata/${encodeURIComponent(key)}?includeGuids=1&X-Plex-Token=${config.plexToken}`,
        { headers: plexClientHeaders(config.plexToken) },
    ).then((r) => r.json()).catch(() => null);
    const meta = data?.MediaContainer?.Metadata?.[0] || {};
    const itemType = String(meta.type || '').toLowerCase();
    // Library-add webhook maps episodes/seasons to the show; Build must do the same.
    if (_depth < 1 && (itemType === 'episode' || itemType === 'season')) {
        const showKey = String(
            meta.grandparentRatingKey
            || (itemType === 'season' ? meta.parentRatingKey : '')
            || '',
        ).trim();
        if (showKey && showKey !== key) {
            return fetchPlexItemProviderIds(config, deps, showKey, { _depth: _depth + 1 });
        }
    }
    return {
        tmdbId: extractTmdbIdFromPlexMeta(meta),
        tvdbId: extractTvdbIdFromPlexMeta(meta),
    };
};

/**
 * Fill missing TMDB/TVDB from per-item Plex metadata.
 * `/all?includeGuids=1` often omits Guid on TV lists — webhook always metadata-fetches.
 * No hard cap: hydrate every row that still lacks both ids, with limited concurrency.
 */
export const hydratePlexLibraryProviderIds = async (config, deps, items = [], {
    concurrency = PLEX_PROVIDER_HYDRATE_CONCURRENCY,
    onlyMissingBoth = true,
} = {}) => {
    const list = Array.isArray(items) ? items : [];
    const needIds = [...new Set(
        list
            .filter((row) => {
                const hasTmdb = /^\d+$/.test(String(row?.tmdbId || '').trim());
                const hasTvdb = /^\d+$/.test(String(row?.tvdbId || '').trim());
                if (!String(row?.id || '').trim()) return false;
                return onlyMissingBoth ? (!hasTmdb && !hasTvdb) : (!hasTmdb || !hasTvdb);
            })
            .map((row) => String(row.id)),
    )];
    if (!needIds.length) return list;
    const byId = new Map();
    await runWithConcurrency(needIds, concurrency, async (ratingKey) => {
        try {
            const ids = await fetchPlexItemProviderIds(config, deps, ratingKey);
            if (ids?.tmdbId || ids?.tvdbId) byId.set(ratingKey, ids);
        } catch {
            // optional — leave the row unchanged
        }
    });
    if (!byId.size) return list;
    return list.map((row) => {
        const hydrated = byId.get(String(row?.id || ''));
        if (!hydrated) return row;
        return {
            ...row,
            tmdbId: row.tmdbId || hydrated.tmdbId || null,
            tvdbId: row.tvdbId || hydrated.tvdbId || null,
        };
    });
};

const pageAllLibraryBrowse = async (browsePage, options = {}) => {
    const pageSize = Math.min(Math.max(Number(options.pageSize) || 2000, 50), 2000);
    const maxItems = Math.min(Math.max(Number(options.maxItems) || 20000, pageSize), 25000);
    const items = [];
    let start = 0;
    let last = { items: [], total: 0, sections: [] };
    for (let page = 0; page < 80; page += 1) {
        last = await browsePage({
            ...options,
            start,
            limit: pageSize,
            allowLarge: true,
        });
        const batch = Array.isArray(last?.items) ? last.items : [];
        const total = Number(last?.total) || 0;
        items.push(...batch);
        if (!batch.length || items.length >= total || items.length >= maxItems) break;
        start += batch.length;
    }
    return {
        ...last,
        items,
        total: items.length,
    };
};

export const listAllPlexLibraryBrowseItems = (config, deps, options = {}) => (
    pageAllLibraryBrowse((pageOptions) => browsePlexLibraryMedia(config, deps, pageOptions), options)
);

export const listAllJellyfinLibraryBrowseItems = (config, deps, options = {}) => (
    pageAllLibraryBrowse((pageOptions) => browseJellyfinLibraryMedia(config, deps, pageOptions), options)
);
